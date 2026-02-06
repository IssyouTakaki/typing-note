// src/main.ts
import "./style.css";
import { getSession, signIn, signOut, signUp } from "./repos/authRepo";
import { supabase } from "./lib/supabaseClient";
import { createMemo, getMemo, listMemos, updateMemo, type MemoRow } from "./repos/supabaseMemoRepo";

type ViewMode = "editor" | "explorer";

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
};

const DEFAULT_TEXT = `# メモ

左に入力すると、右に即反映されます。

- Alt + Ctrl(Win) / ⌘(Mac) + S で保存（Create）
- LIST で Explorer（一覧）
`;

const firstTabId = crypto.randomUUID();

const state: AppState = {
  view: "editor",
  tabs: [
    { id: firstTabId, text: DEFAULT_TEXT, dirty: false, currentMemoId: null }
  ],
  activeTabId: firstTabId,
  memos: [],
};

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

function isSaveShortcut(e: KeyboardEvent) {
  const keyRow = e.key;
  if (typeof keyRow !== "string") return false;
  const key = keyRow.toLowerCase();
  if (key !== "s") return false;

  // 代替案として下記一行を削除する
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return e.altKey && (isMac ? e.metaKey : e.ctrlKey);
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
  // if (!state.dirty) return "noop";

  const tab = activeTab();
  if (!tab.dirty) return "noop";

  const userId = await requireUserId();

  // if (state.currentMemoId) {
  //   await updateMemo({ userId, id: state.currentMemoId, content: state.text });
  //   state.dirty = false;

  if (tab.currentMemoId) {
    await updateMemo({userId, id: tab.currentMemoId, content: tab.text});
    tab.dirty = false;
    return "updated";
  } else {
    // const created = await createMemo({ userId, content: state.text });
    // state.currentMemoId = created.id;

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
      setDirty(true);
    }
  };

  window.addEventListener("keydown", handler, { passive: false });
}

// <div class="tablist" role="tablist" aria-label="Views">
// <button id="editorTabBtn" class="tab is-active" type="button" role="tab" aria-selected="true">EDITOR</button>
// </div>

function mountMemoUI(app: HTMLDivElement) {
  app.innerHTML = `
    <div class="layout">
      <header class="header">
        <div class="topbar"> 
          <div class="title">TypingNote</div>
          <div class="sub">Editor / Explorer</div>
          <button id="logoutBtn" class="btn" style="margin-left:auto;">Logout</button>
        </div>
        
        <nav class="tabbar" aria-label="tabs">
          <div class="tablist" id="tabList" role="tablist" aria-label="Tabs"></div>

          <div class="tabbar-spacer" aria-hidden="true"></div>

          <div class="tab-actions" aria-label="controls">
            <button class="tab util" id="newTabBtn" type="button" aria-label="New Memo"> + </button>
            <button class="tab util" id="openExplorerBtn" type="button" aria-label="Open Explorer">EXPLORER</button>
          </div>
        </nav>
      </header>

      <main class="panes">
        <!-- Editor View -->
        <section id="editorView" class="view">
          <!--
          <div style="display:flex; gap:8px; align-items:center; padding:8px 0;">
            <button id="saveBtn" class="btn" type="button">Save</button>
            <span id="saveState" style="font-size:12px; color:#666;"></span>
          </div>
          -->

          <div id="msgBar" style="display:flex; gap:8px; align-items:center; padding:8px 0;">
            <span id="msgText" style="font-size:12px; color:#666;"></span>
          </div>

          <div class="panes">
            <section class="pane pane-left">
              <div class="pane-header">Input</div>
              <textarea id="memoInput" class="textarea" spellcheck="false"></textarea>
            </section>

            <section class="pane pane-right">
              <div class="pane-header">Preview</div>
              <div id="memoPreview" class="preview"></div>
            </section>
          </div>
        </section>

        <!-- Explorer View -->
        <section id="explorerView" class="view" hidden>
          <div style="display:flex; gap:8px; align-items:center; padding:8px 0;">
            <button id="reloadBtn" class="btn" type="button">Reload</button>
            <span id="listState" style="font-size:12px; color:#666;"></span>
          </div>
          <ul id="memoList" style="list-style:none; padding:0; margin:0;"></ul>
        </section>
      </main>
    </div>
  `;

  // ---- elements
  const logoutBtn = qs<HTMLButtonElement>("#logoutBtn");
  // const editorTabBtn = qs<HTMLButtonElement>("#editorTabBtn");
  const tabList = qs<HTMLDivElement>("#tabList");
  const openExplorerBtn = qs<HTMLButtonElement>("#openExplorerBtn");
  const newTabBtn = qs<HTMLButtonElement>("#newTabBtn");

  const editorView = qs<HTMLElement>("#editorView");
  const explorerView = qs<HTMLElement>("#explorerView");

  const input = qs<HTMLTextAreaElement>("#memoInput");
  const preview = qs<HTMLDivElement>("#memoPreview");
  const msgText = qs<HTMLSpanElement>("#msgText");

  const reloadBtn = qs<HTMLButtonElement>("#reloadBtn");
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
  function setView(view: ViewMode) {
    state.view = view;

    const isEditor = view === "editor";
    editorView.hidden = !isEditor;
    explorerView.hidden = isEditor;

    openExplorerBtn.classList.toggle("is-active", !isEditor);
    openExplorerBtn.setAttribute("aria-pressed", String(!isEditor));
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
    // input.value = state.text;
    // preview.innerHTML = renderPreviewText(state.text);
    // if (state.dirty) msgText.textContent = "Unsaved";

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
        const dt = new Date(m.created_at).toLocaleString();
        return `
          <li style="border:1px solid #e3e6ea; border-radius:12px; padding:10px; margin-bottom:10px;">
            <button class="memo-row" data-id="${escapeHtml(m.id)}" type="button" style="all:unset; cursor:pointer; display:block; width:100%;">
              <div style="font-weight:700;">${title}</div>
              <div style="font-size:12px; color:#666; margin-top:4px;">${dt}</div>
              <div style="font-size:12px; color:#333; margin-top:6px;">${snippet}</div>
            </button>
          </li>
        `;
      })
      .join("");
  }

  async function loadExplorer() {
    try {
      listState.textContent = "Loading...";
      const userId = await requireUserId();
      const list = await listMemos({ userId, limit: 50 });
      state.memos = list;
      renderExplorer(list);
      listState.textContent = `${list.length} memos`;
    } catch (e) {
      console.error(e);
      listState.textContent = "Failed to load";
      memoList.innerHTML = `<li style="padding:10px; color:#b00020;">Failed to load.</li>`;
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
  reloadBtn.addEventListener("click", async () => {
    await loadExplorer();
  });

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

  // ---- nav actions
  async function goExplorer() {

    const r = await autoUpdateIfEditingCurrentMemo();
    if (r === "updated") {
      setDirty(false);
      showMessage("Updated ✨");
    }

    setView("explorer");
    await loadExplorer();
  }

  goExplorerHandler = goExplorer;

  // editorTabBtn.addEventListener("click", () => setView("editor"));
  openExplorerBtn.addEventListener("click", () => void goExplorer());

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

  // ★ Explorerだった場合は一覧も復元（タブ復帰でも勝手にEditorへ戻らない）
  if (state.view === "explorer") {
    void loadExplorer();
  }  
  registerSaveShortcut();
}

function mountAuthUI(app: HTMLDivElement, message = "") {
  goExplorerHandler = null;
  newTabHandler = null;

  app.innerHTML = `
    <div class="layout" style="justify-content:center; align-items:center;">
      <div style="width:min(420px, 92vw); background:#fff; border:1px solid #e3e6ea; border-radius:12px; padding:16px;">
        <div style="font-weight:700; font-size:16px; margin-bottom:8px;">TypingNote Login</div>
        <div style="font-size:12px; color:#666; margin-bottom:12px;">
          サインアップ後、確認メールのリンクを開いてからログインしてください（メール確認必須）
        </div>

        ${message ? `<div style="white-space:pre-wrap; font-size:12px; color:#b00020; margin-bottom:10px;">${escapeHtml(message)}</div>` : ""}

        <label style="display:block; font-size:12px; margin-bottom:6px;">Email</label>
        <input id="email" class="input" type="email" autocomplete="email" style="width:100%; padding:10px; border:1px solid #e3e6ea; border-radius:10px; margin-bottom:10px;" />

        <label style="display:block; font-size:12px; margin-bottom:6px;">Password</label>
        <input id="password" class="input" type="password" autocomplete="current-password" style="width:100%; padding:10px; border:1px solid #e3e6ea; border-radius:10px; margin-bottom:12px;" />

        <div style="display:flex; gap:10px;">
          <button id="signupBtn" class="btn" style="flex:1; padding:10px; border-radius:10px; border:1px solid #e3e6ea; background:#fff;">Sign up</button>
          <button id="signinBtn" class="btn" style="flex:1; padding:10px; border-radius:10px; border:1px solid #111; background:#111; color:#fff;">Sign in</button>
        </div>

        <div style="font-size:12px; color:#666; margin-top:12px;">
          ※メールが届かない場合は、Supabase → Authentication → Users で確認状態を見直してください。
        </div>
      </div>
    </div>
  `;

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
      const res = await signUp(email, password);
      console.log("signUp:", res);
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
}

async function rerender() {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("#app not found");

  const session = await getSession();
  if (session) {
    mountMemoUI(app);
  } else {
    mountAuthUI(app);
  }
}

async function mount() {
  // auth state が変わった時も画面を更新
  supabase.auth.onAuthStateChange((event) => {
    // タブ復帰やトークン更新で毎回UI作り直すのを防ぐ
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
      rerender().catch(console.error);
    }
  });
  
  await rerender();
}

mount().catch(console.error);
