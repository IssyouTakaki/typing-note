// src/main.ts
import "./style.css";
import { getSession, signIn, signOut, signUp } from "./repos/authRepo";
import { supabase } from "./lib/supabaseClient";
import { createMemo, getMemo, listMemos, listDustMemos, updateMemo, type MemoRow } from "./repos/supabaseMemoRepo";

import memoUIHtml from "./templates/memoUI.html?raw";
import mountAuthUIHtml from "./templates/mountAuthUI.html?raw";
import resetPasswordUIHtml from "./templates/resetPasswordUI.html?raw";

type ViewMode = "editor" | "explorer" | "dust";

type TabState = {
  id: string;
  text: string;
  dirty: boolean;
  currentMemoId: string | null;
};

type AppState = {
  view: ViewMode;
  tabs: TabState[];
  activeTabId: string;
  memos: MemoRow[];
  explorerSortMode: 0 | 1 | 2 | 3;
};

const DEFAULT_TEXT = `# Shortcut List

1. ALT + SHIFT + CONTROL + 0 = Go To Explorer Tab
2. ALT + SHIFT + CONTROL + S = Save a Memo
3. ALT + SHIFT + CONTROL + T = Create a Memo
4. ALT + SHIFT + CONTROL + O = Sort on Explorer Tab

`;

const firstTabId = crypto.randomUUID();

const state: AppState = {
  view: "editor",
  tabs: [
    { id: firstTabId, text: DEFAULT_TEXT, dirty: false, currentMemoId: null }
  ],
  activeTabId: firstTabId,
  memos: [],
  explorerSortMode: 0,
};

function formatYmd(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function activeTab(): TabState {
  const t = state.tabs.find((x) => x.id === state.activeTabId);
  if (!t) throw new Error("active tab not found");
  return t;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPreviewText(text: string): string {
  const escaped = escapeHtml(text);
  return `<pre class="preview-pre">${escaped}</pre>`;
}

function memoTitleFromContent(content: string) {
  const first = content.split("\n")[0]?.trim() ?? "";
  return first.replace(/^#+\s*/, "").slice(0, 40) || "(no title)";
}

function memoSnippet(content: string) {
  const s = content.replaceAll("\n", " ").trim();
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

const TAB_TITLE_MAX = 12;

function extractFirstLineTitle(text: string, maxLen: number) {
  const first = (text.split("\n")[0] ?? "").trim();
  const clean = first.replace(/^#+\s*/, "");
  if (!clean) return "EDITOR";
  return clean.length > maxLen ? clean.slice(0, maxLen) + " ..." : clean;
}

let saveShortcutRegistered = false;

let goExplorerHandler: (() => Promise<void>) | null = null;
let newTabHandler: (() => Promise<void>) | null = null;
let sortExplorerHandler: (() => Promise<void>) | null = null;

function isSaveShortcut(e: KeyboardEvent) {
  const keyRow = e.key;
  if (typeof keyRow !== "string") return false;
  const key = keyRow.toLowerCase();
  if (key !== "s") return false;

  // 代替案として下記一行を削除する
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return e.altKey && (isMac ? e.metaKey : e.ctrlKey);
}

function isExplorerSortShortcut(e: KeyboardEvent) {
  const keyRow = e.key;
  if (typeof keyRow !== "string") return false;
  if (keyRow.toLowerCase() !== "o") return false;

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const hasMod = isMac ? e.metaKey : e.ctrlKey;

  return e.altKey && e.shiftKey && hasMod;
}

function isNewShortcut(e:KeyboardEvent) {
  const keyRow = e.key;
  if (typeof keyRow !== "string") return false;
  if (keyRow.toLowerCase() !== "t") return false;

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const hasMod = isMac ? e.metaKey : e.ctrlKey;

  return e.altKey && hasMod && e.shiftKey;  
}

function getShortcutDigit(e: KeyboardEvent): number | null {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const hasMod = isMac ? e.metaKey : e.ctrlKey;

  // ここが「Alt + Ctrl(Win) / ⌘(Mac) + 数字」の入口
  if (!e.altKey || !hasMod) return null;

  // code 優先（安定）
  if (e.code?.startsWith("Digit")) {
    const n = Number(e.code.slice("Digit".length));
    return Number.isFinite(n) ? n : null;
  }
  if (e.code?.startsWith("Numpad")) {
    const n = Number(e.code.slice("Numpad".length));
    return Number.isFinite(n) ? n : null;
  }

  // フォールバック
  const k = typeof e.key === "string" ? e.key : "";
  if (/^[0-9]$/.test(k)) return Number(k);

  return null;
}

function qs<T extends Element>(selector: string): T {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el as T;
}

let msgTimer: number | undefined;

function showMessage(text: string, ms = 1800) {
  const msgText = qs<HTMLSpanElement>("#msgText");
  msgText.textContent = text;
  if (msgTimer) window.clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => {
    msgText.textContent = activeTab().dirty ? "Unsaved" : "";
  }, ms);
}

async function requireUserId(): Promise<string> {
  const session = await getSession();
  const userId = session?.user.id;
  if (!userId) throw new Error("not Logged in");
  return userId;
}

type SaveResult = "noop" | "created" | "updated";

type AutoUpdateResult = "noop" | "updated";

/**
 * タブ遷移などで「編集中の既存メモ」を自動更新したい時に使う。
 * - currentMemoId がある（=既存メモ）
 * - dirty になっている
 * の場合だけ update を実行する（新規作成はしない）
**/

async function autoUpdateIfEditingCurrentMemo(): Promise<AutoUpdateResult> {
  // if (!state.dirty) return "noop";
  // if (!state.currentMemoId) return "noop";

  const tab = activeTab();
  if (!tab.dirty) return "noop";
  if (!tab.currentMemoId) return "noop";

  const userId = await requireUserId();
  
  // await updateMemo({ userId, id: state.currentMemoId, content: state.text });
  // state.dirty = false;

  await updateMemo ({userId, id: tab.currentMemoId, content: tab.text});
  tab.dirty = false;
  return "updated";
}


async function saveIfDirty(): Promise<SaveResult> {

  const tab = activeTab();
  if (!tab.dirty) return "noop";

  const userId = await requireUserId();

  if (tab.currentMemoId) {
    await updateMemo({userId, id: tab.currentMemoId, content: tab.text});
    tab.dirty = false;
    return "updated";
  } else {

    const created = await createMemo({userId, content: tab.text});
    tab.currentMemoId = created.id;
    return "created";
  }
}

function registerSaveShortcut() {
  if (saveShortcutRegistered) return;
  saveShortcutRegistered = true;

  const handler = async (e: KeyboardEvent) => {
    if (!(e instanceof KeyboardEvent)) return;
    if (e.isComposing) return;

    const digit = getShortcutDigit(e);
    
    if (digit !== null) {
      e.preventDefault();

      if (digit === 0) {
        if (goExplorerHandler) void goExplorerHandler();
      }

      return;
    }

    if (isExplorerSortShortcut(e)) {
      e.preventDefault();
      if (sortExplorerHandler) void sortExplorerHandler();
      return;
    }

    if (isNewShortcut(e)) {
      e.preventDefault();
      if (newTabHandler) void newTabHandler();
      return;
    }

    if (!isSaveShortcut(e)) return;

    e.preventDefault();
  
    try {
      const result = await saveIfDirty();

      if (result === "updated") showMessage("Updated ✨");
      else if (result === "created") showMessage("Created a new memo 🚀");
      else showMessage("Nothing to save - you're all set.");
    } catch (err) {
      console.error("save failed", err);
      showMessage("Oops - save failed 😵‍💫", 2500);
      // setDirty(true);
    }
  };

  window.addEventListener("keydown", handler, { passive: false });
}

function mountMemoUI(app: HTMLDivElement) {
  app.innerHTML = memoUIHtml;

  // ---- elements
  const logoutBtn = qs<HTMLButtonElement>("#logoutBtn");
  // const editorTabBtn = qs<HTMLButtonElement>("#editorTabBtn");
  const tabList = qs<HTMLDivElement>("#tabList");
  const openExplorerBtn = qs<HTMLButtonElement>("#openExplorerBtn");
  const newTabBtn = qs<HTMLButtonElement>("#newTabBtn");

  const openDustBtn = qs<HTMLButtonElement>("#openDustBtn");

  const dustView = qs<HTMLElement>("#dustView");
  const dustState = qs<HTMLSpanElement>("#dustState");
  const dustList = qs<HTMLUListElement>("#dustList");  
  
  const editorView = qs<HTMLElement>("#editorView");
  const explorerView = qs<HTMLElement>("#explorerView");

  const input = qs<HTMLTextAreaElement>("#memoInput");
  const preview = qs<HTMLDivElement>("#memoPreview");
  const msgText = qs<HTMLSpanElement>("#msgText");

  // const reloadBtn = qs<HTMLButtonElement>("#reloadBtn");
  const listState = qs<HTMLSpanElement>("#listState");
  const memoList = qs<HTMLUListElement>("#memoList");

  newTabHandler = async () => {
    await createNewTab();
  };  

  function renderTabs() {
    tabList.innerHTML = state.tabs.map(t => {
      const label = extractFirstLineTitle(t.text, TAB_TITLE_MAX);
      const isActive = t.id === state.activeTabId;

      return `
        <button
          class="tab ${isActive ? "is-active" : ""}"
          type="button"
          role="tab"
          data-tab-id="${escapeHtml(t.id)}"
          aria-selected="${isActive ? "true" : "false"}"
          title="${escapeHtml(label)}"
          aria-label="Tab: ${escapeHtml(label)}"
        >${escapeHtml(label)}</button>
      `;
    }).join("");
  }  
  
  async function activateTab(tabId: string) {
    // タブ切替時に「保存したい」ならここに saveIfDirty() を入れる
    state.activeTabId = tabId;
    renderEditor();     // active tab の内容を editor に流し込む
    renderTabs();       // active 表示更新
    setView("editor");
    input.focus();
  }
  
  async function createNewTab() {
    const id = crypto.randomUUID();
    state.tabs.push({ id, text: "", dirty: false, currentMemoId: null });
    await activateTab(id);
  }
  
  tabList.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>("button[data-tab-id]");
    const tabId = btn?.getAttribute("data-tab-id");
    if (!tabId) return;
    void activateTab(tabId);
  });
  
  // ---- view helpers
  // function setView(view: ViewMode) {
  //   state.view = view;

  //   const isEditor = view === "editor";
  //   editorView.hidden = !isEditor;
  //   explorerView.hidden = isEditor;

  //   openExplorerBtn.classList.toggle("is-active", !isEditor);
  //   openExplorerBtn.setAttribute("aria-pressed", String(!isEditor));
  // }

  function setView(view: ViewMode) {
    state.view = view;
  
    const isEditor = view === "editor";
    const isExplorer = view === "explorer";
    const isDust = view === "dust";
  
    editorView.hidden = !isEditor;
    explorerView.hidden = !isExplorer;
    dustView.hidden = !isDust;
  
    openExplorerBtn.classList.toggle("is-active", isExplorer);
    openExplorerBtn.setAttribute("aria-pressed", String(isExplorer));
  
    openDustBtn.classList.toggle("is-active", isDust);
    openDustBtn.setAttribute("aria-pressed", String(isDust));
  }
  
  let msgTimer: number | undefined;

  function showMessage(text: string, ms = 1800) {
    msgText.textContent = text;
    if (msgTimer) window.clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => {
      // msgText.textContent = state.dirty ? "Unsaved" : "";
      msgText.textContent = activeTab().dirty ? "Unsaved" : "";
    }, ms);
  }
  
  function setDirty(next: boolean) {
    // state.dirty = next;
    activeTab().dirty = next;

    msgText.textContent = activeTab().dirty ? "Unsaved" : "";
  }

  // ---- renderers
  function renderEditor() {

    const tab = activeTab();
    input.value = tab.text;
    preview.innerHTML = renderPreviewText(tab.text);
    if (tab.dirty) msgText.textContent = "Unsaved";
  }

  function renderExplorer(list: MemoRow[]) {
    if (list.length === 0) {
      memoList.innerHTML = `<li style="padding:10px; color:#666;">(empty)</li>`;
      return;
    }

    memoList.innerHTML = list
      .map((m) => {
        const title = escapeHtml(memoTitleFromContent(m.content));
        const snippet = escapeHtml(memoSnippet(m.content));
        const created = formatYmd(m.created_at);
        const updated = m.updated_at ? formatYmd(m.updated_at) : created;
        return `
          <li style="border:1px solid #e3e6ea; border-radius:12px; padding:10px; margin-bottom:10px;">
            <button class="memo-row" data-id="${escapeHtml(m.id)}" type="button" style="all:unset; cursor:pointer; display:block; width:100%;">
              <div style="font-weight:700;">${title}</div>
              <div style="font-size:12px; color:#666; margin-top:6px;">
                <div>Created Date: ${created}</div>
                <div>Updated Date: ${updated}</div>
              </div>
              <div style="font-size:12px; color:#333; margin-top:6px;">${snippet}</div>
            </button>
          </li>
        `;
      })
      .join("");
  }

  function renderDust(list: MemoRow[]) {
    if (list.length === 0) {
      dustList.innerHTML = `<li style="padding:10px; color:#666;">(empty)</li>`;
      return;
    }
  
    dustList.innerHTML = list
      .map((m) => {
        const title = escapeHtml(memoTitleFromContent(m.content));
        const snippet = escapeHtml(memoSnippet(m.content));
        const trashed = formatYmd(m.deleted_at);
        return `
          <li style="border:1px solid #e3e6ea; border-radius:12px; padding:10px; margin-bottom:10px;">
            <button class="memo-row" data-id="${escapeHtml(m.id)}" type="button"
              style="all:unset; cursor:pointer; display:block; width:100%;">
              <div style="font-weight:700;">${title}</div>
              <div style="font-size:12px; color:#666; margin-top:6px;">
                <div>Trashed Date: ${trashed}</div>
              </div>
              <div style="font-size:12px; color:#333; margin-top:6px;">${snippet}</div>
            </button>
          </li>
        `;
      })
      .join("");
  }

  // --- Explorer sort ---
  const collEn = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const collJa = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

  function titleOf(m: MemoRow) {
    return memoTitleFromContent(m.content);
  }

  function isAsciiStart(s: string) {
    return /^[A-Za-z0-9]/.test(s);
  }

  function getSortedExplorerList(list: MemoRow[]) {
    const mode = state.explorerSortMode;

    // mode=0 は「未選択」なので、サーバ既定（created_at desc）をそのまま
    if (mode === 0) return list;

    if (mode === 1) {
      // 1) アルファベット順 → 五十音順（英数始まりを先に、その他を後に）
      return [...list].sort((a, b) => {
        const ta = titleOf(a);
        const tb = titleOf(b);

        const ga = isAsciiStart(ta) ? 0 : 1;
        const gb = isAsciiStart(tb) ? 0 : 1;
        if (ga !== gb) return ga - gb;

        // グループ内の比較
        return ga === 0 ? collEn.compare(ta, tb) : collJa.compare(ta, tb);
      });
    }

    if (mode === 2) {
      // 2) 更新日順（updated_at が無い/NULLなら created_at を使う）
      return [...list].sort((a, b) => {
        const da = Date.parse((a.updated_at ?? a.created_at) as string);
        const db = Date.parse((b.updated_at ?? b.created_at) as string);
        return db - da; // 新しい順
      });
    }

    // 3) 作成順（新しい順）
    return [...list].sort((a, b) => {
      const da = Date.parse(a.created_at);
      const db = Date.parse(b.created_at);
      return db - da;
    });
  }

  function sortLabel(mode: 0 | 1 | 2 | 3) {
    if (mode === 1) return "Sort: Title (A→あ)";
    if (mode === 2) return "Sort: Updated (newest)";
    if (mode === 3) return "Sort: Created (newest)";
    return "Sort: (not set)";
  }


  async function loadExplorer() {
    try {
      listState.textContent = "Loading...";
      const userId = await requireUserId();
      const list = await listMemos({ userId, limit: 50 });
      state.memos = list;
      renderExplorer(getSortedExplorerList(list));
      listState.textContent = `${list.length} memos`;
    } catch (e) {
      console.error(e);
      listState.textContent = "Failed to load";
      memoList.innerHTML = `<li style="padding:10px; color:#b00020;">Failed to load.</li>`;
    }
  }

  async function loadDust() {
    try {
      dustState.textContent = "Loading...";
      const userId = await requireUserId();
      const list = await listDustMemos({ userId, limit: 50 });
      renderDust(list);
      dustState.textContent = `${list.length} trashed memos`;
    } catch (e) {
      console.error(e);
      dustState.textContent = "Failed to load";
      dustList.innerHTML = `<li style="padding:10px; color:#b00020;">Failed to load.</li>`;
    }
  }

  // ---- wire editor
  renderEditor();
  renderTabs();


  input.addEventListener("input", () => {
    activeTab().text = input.value;
    setDirty(true);
    preview.innerHTML = renderPreviewText(activeTab().text);
    renderTabs();
  });

  // ---- wire explorer
  // reloadBtn.addEventListener("click", async () => {
  //   await loadExplorer();
  // });

  memoList.addEventListener("click", async (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>("button.memo-row");
    const id = btn?.dataset.id;
    if (!id) return;

    try {
      // ここは「切替前に保存」したいなら入れる
      await saveIfDirty();

      const userId = await requireUserId();
      const memo = await getMemo({ userId, id });
      if (!memo) return;

      activeTab().currentMemoId = memo.id;
      activeTab().text = memo.content;
      setDirty(false);

      renderEditor();
      renderTabs();    
      // updateEditorTabLabel();
      setView("editor");
    } catch (e) {
      console.error(e);
    }
  });

  async function goExplorer() {
    const r = await autoUpdateIfEditingCurrentMemo();
  
    setView("explorer");
    showMessage(r === "updated" ? "Updated ✨ — Explorer opened" : "Explorer opened");
  
    await loadExplorer();
  }  

  async function goDust() {
    const r = await autoUpdateIfEditingCurrentMemo();
    setView("dust");
    showMessage(r === "updated" ? "Updated ✨ — Dust opened" : "Dust opened");
    await loadDust();
  }

  goExplorerHandler = goExplorer;

  sortExplorerHandler = async () => {
    // Explorer 以外で押されたら事故防止：何もしないで案内だけ
    if (state.view !== "explorer") {
      showMessage("Sort is available in Explorer.");
      return;
    }
  
    // 1 → 2 → 3 → 1 ... （0からなら最初は1）
    state.explorerSortMode = ((state.explorerSortMode % 3) + 1) as 1 | 2 | 3;
  
    // まだ未ロードなら読み込む（空配列のまま押された時用）
    if (state.memos.length === 0) {
      await loadExplorer();
      // loadExplorer 内で render 済みだが、念のため現在modeで再描画
      renderExplorer(getSortedExplorerList(state.memos));
    } else {
      renderExplorer(getSortedExplorerList(state.memos));
    }
  
    showMessage(sortLabel(state.explorerSortMode));
  };
  

  // editorTabBtn.addEventListener("click", () => setView("editor"));
  openExplorerBtn.addEventListener("click", () => void goExplorer());

  openDustBtn.addEventListener("click", () => void goDust());

  async function newDraft() {

    await saveIfDirty();
    activeTab().currentMemoId = null;
    activeTab().text = "";
    setDirty(false);
    renderEditor();
    renderTabs();
    // updateEditorTabLabel();
    setView("editor");
    input.focus();    
  }

  // newTabHandler = newDraft;
  // newTabBtn.addEventListener("click", () => void newDraft());
  newTabBtn.addEventListener("click", () => void createNewTab());

  logoutBtn.addEventListener("click", async () => {
    await signOut();
    await rerender();
  });

  // ★ DOM生成後、state.view を必ず反映する
  setView(state.view);

  if (state.view === "explorer") {
    void loadExplorer();
  } else if (state.view === "dust") {
    void loadDust();
  }
    
  registerSaveShortcut();
}

function mountAuthUI(app: HTMLDivElement, message = "") {
  goExplorerHandler = null;
  newTabHandler = null;

  app.innerHTML = mountAuthUIHtml;

  // message の表示（HTML埋め込みはしない。textContentで安全に）
  const msgEl = qs<HTMLDivElement>("#authMsg");

  if (message) {
    msgEl.hidden = false;
    msgEl.textContent = message;
  } else {
    msgEl.hidden = true;
    msgEl.textContent = "";
  }

  const emailEl = qs<HTMLInputElement>("#email");
  const passEl = qs<HTMLInputElement>("#password");
  const signupBtn = qs<HTMLButtonElement>("#signupBtn");
  const signinBtn = qs<HTMLButtonElement>("#signinBtn");

  const getValues = () => ({
    email: emailEl.value.trim(),
    password: passEl.value,
  });

  signupBtn.addEventListener("click", async () => {
    try {
      const { email, password } = getValues();
      if (!email || !password) return mountAuthUI(app, "Email と Password を入力してください。");
      await signUp(email, password);
      mountAuthUI(app, "サインアップしました。\n確認メールのリンクを開いた後に Sign in してください。");
    } catch (e: any) {
      console.error(e);
      mountAuthUI(app, e?.message ?? String(e));
    }
  });

  signinBtn.addEventListener("click", async () => {
    try {
      const { email, password } = getValues();
      if (!email || !password) return mountAuthUI(app, "Email と Password を入力してください。");
      await signIn(email, password);
      await rerender();
    } catch (e: any) {
      console.error(e);
      mountAuthUI(app, e?.message ?? String(e));
    }
  });

  const forgotBtn = qs<HTMLButtonElement>("#forgotBtn");

  forgotBtn.addEventListener("click", async () => {
    try {
      const email = emailEl.value.trim();
      if (!email) return mountAuthUI(app, "Email を入力してください。");

      const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;

      mountAuthUI(app, "リセットメールを送信しました。メールのリンクを開いてください。");
    } catch (e: any) {
      console.error(e);
      mountAuthUI(app, e?.message ?? String(e));
    }
  });
}

let authMode: "normal" | "recovery" = "normal";

function mountResetPasswordUI(app: HTMLDivElement) {
  app.innerHTML = resetPasswordUIHtml;

  const msg = qs<HTMLDivElement>("#resetMsg");
  const p1 = qs<HTMLInputElement>("#newPassword");
  const p2 = qs<HTMLInputElement>("#newPassword2");
  const form = qs<HTMLFormElement>("#resetForm");

  const show = (t: string) => {
    msg.hidden = false;
    msg.textContent = t;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const a = p1.value;
    const b = p2.value;
    if (!a || !b) return show("パスワードを入力してください");
    if (a !== b) return show("確認用パスワードが一致しません");

    const { error } = await supabase.auth.updateUser({ password: a });
    if (error) return show(error.message);

    show("更新しました。ログイン画面に戻ります。");
    authMode = "normal";
    await supabase.auth.signOut();
    await rerender();
  });
}




async function rerender() {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("#app not found");

  if (authMode === "recovery") {
    mountResetPasswordUI(app);
    return;
  }

  const session = await getSession();
  if (session) mountMemoUI(app);
  else mountAuthUI(app);
}


async function mount() {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      authMode = "recovery";
      rerender().catch(console.error);
      return;
    }
    if (event === "SIGNED_OUT") authMode = "normal";

    if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
      rerender().catch(console.error);
    }
  });

  await rerender();
}


mount().catch(console.error);
