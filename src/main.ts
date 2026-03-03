// src/main.ts
import "./style.css";
import { getSession, signIn, signOut, signUp } from "./repos/authRepo";
import { supabase } from "./lib/supabaseClient";
import {
  createMemo, getMemo, listMemos, listDustMemos, updateMemo, trashMemo, restoreMemo, hardDeleteMemo,
  type MemoRow
} from "./repos/supabaseMemoRepo";

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
  explorerSortMode: 0 | 1 | 2 | 3 | 4;

    // --- List focus / multi-select (Explorer & Dust) ---
    explorerFocusId: string | null;
    explorerSelectedIds: Set<string>;
    dustFocusId: string | null;
    dustSelectedIds: Set<string>;
};

const DEFAULT_TEXT = `# Shortcut List

01. ALT + SHIFT + CONTROL + 1-8 = Go To Memo Tab
02. ALT + SHIFT + CONTROL + 0 = Go To Dust Tab
03. ALT + SHIFT + CONTROL + 9 = Go To Explorer Tab
04. ALT + SHIFT + CONTROL + S = Save a Memo
05. ALT + SHIFT + CONTROL + T = Create a Memo
06. ALT + SHIFT + CONTROL + D = Delete a Memo
07. ALT + SHIFT + CONTROL + O = Sort on Explorer Tab
08. ALT + SHIFT + CONTROL + SPACE = (Explorer/Dust) Toggle select (multi)
09. (Explorer/Dust) Arrow Up/Down = Move focus
10. (Explorer/Dust) Enter = Open focused memo (when none selected)
11. ALT + SHIFT + CONTROL + V = Toggle Preview Wide (Hide/Show Input)

# Markdown Preview (implemented)

- Headings: # / ## / ###
- Unordered list: - item
- Ordered list: 1. item
- Horizontal rule: ---

Inline code example: \`const x = 1;\`

Code block example:
\`\`\`ts
function hello() {
  console.log("hi");
}
\`\`\`

`;

const firstTabId = crypto.randomUUID();

const state: AppState = {
  view: "editor",
  tabs: [
    { id: firstTabId, text: DEFAULT_TEXT, dirty: false, currentMemoId: null }
  ],
  activeTabId: firstTabId,
  memos: [],
  explorerSortMode: 2,
  
  // --- List focus / multi-select (Explorer & Dust) ---
  explorerFocusId: null,
  explorerSelectedIds: new Set<string>(),
  dustFocusId: null,
  dustSelectedIds: new Set<string>(),
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

function renderInlineCode(input: string): string {
  // `code` を <code> に変換し、それ以外は escape
  // ※閉じ ` が無い場合は、残りを普通のテキストとして扱う
  let out = "";
  let i = 0;

  while (i < input.length) {
    const s = input.indexOf("`", i);
    if (s === -1) {
      out += escapeHtml(input.slice(i));
      break;
    }

    out += escapeHtml(input.slice(i, s));

    const e = input.indexOf("`", s + 1);
    if (e === -1) {
      out += escapeHtml(input.slice(s)); // unmatched `
      break;
    }

    const code = input.slice(s + 1, e);
    out += `<code class="md-code-inline">${escapeHtml(code)}</code>`;
    i = e + 1;
  }

  return out;
}

// --- Minimal Markdown (Phase 3): headings + lists + hr + code blocks + inline code
function renderPreviewMarkdown(text: string): string {
  const lines = text.split(/\r?\n/);

  const parts: string[] = [];
  let buf: string[] = [];
  let listMode: "ul" | "ol" | null = null;

  // fenced code block state
  let inFence = false;
  let fenceLang = "";
  let fenceBuf: string[] = [];

  const flushText = () => {
    if (buf.length === 0) return;
    const html = renderInlineCode(buf.join("\n"));
    parts.push(`<pre class="preview-pre">${html}</pre>`);
    buf = [];
  };

  const closeList = () => {
    if (!listMode) return;
    parts.push(listMode === "ul" ? `</ul>` : `</ol>`);
    listMode = null;
  };

  const openList = (mode: "ul" | "ol") => {
    if (listMode === mode) return;
    closeList();
    flushText();
    parts.push(mode === "ul" ? `<ul class="md-ul">` : `<ol class="md-ol">`);
    listMode = mode;
  };

  const flushFence = () => {
    const code = escapeHtml(fenceBuf.join("\n"));
    const langAttr = fenceLang ? ` data-lang="${escapeHtml(fenceLang)}"` : "";
    parts.push(
      `<pre class="md-codeblock"${langAttr}><code class="md-code">${code}</code></pre>`
    );
    fenceBuf = [];
    fenceLang = "";
  };

  for (const line of lines) {
    // --- fenced code block ---
    const fenceMatch = line.match(/^\s*```(\S*)\s*$/);
    if (fenceMatch) {
      // toggle
      if (!inFence) {
        closeList();
        flushText();
        inFence = true;
        fenceLang = (fenceMatch[1] ?? "").trim(); // ```ts みたいな言語指定は任意
        fenceBuf = [];
      } else {
        // close fence
        inFence = false;
        flushFence();
      }
      continue;
    }

    if (inFence) {
      // inside code block: do NOT parse markdown
      fenceBuf.push(line);
      continue;
    }

    // horizontal rule: "---"
    if (/^\s*---\s*$/.test(line)) {
      closeList();
      flushText();
      parts.push(`<hr class="md-hr">`);
      continue;
    }

    // blank line
    if (line.trim() === "") {
      if (listMode) {
        closeList();
        parts.push(`<div class="md-blank"></div>`);
      } else {
        if (buf.length === 0) parts.push(`<div class="md-blank"></div>`);
        else buf.push("");
      }
      continue;
    }

    // headings (# / ## / ###)
    {
      const m = line.match(/^(#{1,3})\s+(.+)$/);
      if (m) {
        const level = m[1].length as 1 | 2 | 3;
        const content = m[2].trim();
        if (content.length > 0) {
          closeList();
          flushText();
          parts.push(
            `<h${level} class="md-h${level}">${renderInlineCode(content)}</h${level}>`
          );
          continue;
        }
      }
    }

    // unordered list: "- item"
    {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m) {
        const content = m[1].trim();
        if (content.length > 0) {
          openList("ul");
          parts.push(`<li class="md-li">${renderInlineCode(content)}</li>`);
          continue;
        }
      }
    }

    // ordered list: "1. item"
    {
      const m = line.match(/^\s*(\d+)\.\s+(.+)$/);
      if (m) {
        const content = m[2].trim();
        if (content.length > 0) {
          openList("ol");
          parts.push(`<li class="md-li">${renderInlineCode(content)}</li>`);
          continue;
        }
      }
    }

    // normal text
    if (listMode) closeList();
    buf.push(line);
  }

  // EOF: fence が閉じられていない場合も一応表示
  if (inFence) {
    inFence = false;
    flushFence();
  }

  closeList();
  flushText();

  return `<div class="md-preview">${parts.join("\n")}</div>`;
}

function renderPreviewText(text: string): string {
  const escaped = escapeHtml(text);
  return `<pre class="preview-pre">${escaped}</pre>`;
}

function memoTitleFromContent(content: string) {
  const first = content.split("\n")[0]?.trim() ?? "";
  const mh = first.match(/^#{1,6}\s+(.+)$/);
  const title = (mh ? mh[1] : first).trim();
  return title.slice(0, 40) || "(no title)";
}

function memoSnippet(content: string) {
  const s = content.replaceAll("\n", " ").trim();
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

function memoSizeBytes(content: string): number {
  // UTF-8バイト数（Blobは内部でUTF-8扱い）
  try {
    return new Blob([content]).size;
  } catch {
    // 念のためのフォールバック（環境によってBlobが無いケース）
    return content.length;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function extractPseudoTags(text: string): string[] {
  // Pseudo tags: "#aiueo" (no space after #)
  // - Exclude headings "# title" (space after #)
  // - Exclude code blocks / inline code to reduce false positives
  // - Allow Japanese and common symbols: letters/numbers/_/-
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ");

  const map = new Map<string, string>(); // key -> display (first seen)
  const re = /(^|[^\p{L}\p{N}_\-#])#([\p{L}\p{N}_\-]{1,30})/gu;

  for (const m of cleaned.matchAll(re)) {
    const raw = m[2];
    if (!raw) continue;

    // de-dupe case-insensitively for ASCII tags (e.g. AI vs ai)
    const key = /[A-Za-z]/.test(raw) ? raw.toLowerCase() : raw;
    if (!map.has(key)) map.set(key, raw);
  }

  return Array.from(map.values());
}


const TAB_TITLE_MAX = 12;
const MAX_TABS = 8;


function extractFirstLineTitle(text: string, maxLen: number) {
  const first = (text.split("\n")[0] ?? "").trim();
  const mh = first.match(/^#{1,6}\s+(.+)$/);
  const clean = (mh ? mh[1] : first).trim();
  if (!clean) return "EDITOR";
  return clean.length > maxLen ? clean.slice(0, maxLen) + " ..." : clean;
}

let saveShortcutRegistered = false;

let goExplorerHandler: (() => Promise<void>) | null = null;
let goDustHandler: (() => Promise<void>) | null = null;
let newTabHandler: (() => Promise<void>) | null = null;
let sortExplorerHandler: (() => Promise<void>) | null = null;
let deleteMemoHandler: (() => Promise<void>) | null = null;
let closeTabHandler: (() => Promise<void>) | null = null;
let switchTabHandler: ((digit: number) => Promise<void>) | null = null;
let togglePreviewWideHandler: (() => Promise<void>) | null = null;

// --- List focus / multi-select (Explorer & Dust) ---
let explorerSelectToggleHandler: (() => Promise<void>) | null = null;
let explorerMoveFocusHandler: ((delta: -1 | 1) => Promise<void>) | null = null;
let explorerOpenFocusHandler: (() => Promise<void>) | null = null;
let dustSelectToggleHandler: (() => Promise<void>) | null = null;
let dustMoveFocusHandler: ((delta: -1 | 1) => Promise<void>) | null = null;
let dustOpenFocusHandler: (() => Promise<void>) | null = null;



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

function isListSelectToggleShortcut(e: KeyboardEvent) {
  const keyRow = e.key;
  if (typeof keyRow !== "string") return false;
  // Space can be reported as " " or "Space"
  const isSpace = keyRow === " " || keyRow === "Space" || e.code === "Space";
  if (!isSpace) return false;

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

function isDeleteShortcut(e: KeyboardEvent) {
  const keyRow = e.key;
  if (typeof keyRow !== "string") return false;
  if (keyRow.toLowerCase() !== "d") return false;

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const hasMod = isMac ? e.metaKey : e.ctrlKey;
  return e.altKey && e.shiftKey && hasMod;
}

function isCloseShortcut(e: KeyboardEvent) {
  const keyRow = e.key;
  if (typeof keyRow !== "string") return false;
  if (keyRow.toLowerCase() !== "w") return false;

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const hasMod = isMac ? e.metaKey : e.ctrlKey;
  return e.altKey && e.shiftKey && hasMod;
}

function isTogglePreviewWideShortcut(e: KeyboardEvent) {
  const keyRow = e.key;
  if (typeof keyRow !== "string") return false;
  if (keyRow.toLowerCase() !== "v") return false;

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const hasMod = isMac ? e.metaKey : e.ctrlKey;

  return e.altKey && e.shiftKey && hasMod;
}

function keyConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "key-confirm-overlay";

    const card = document.createElement("div");
    card.className = "key-confirm";

    const title = document.createElement("div");
    title.className = "key-confirm-title";
    title.textContent = "Confirm";

    const body = document.createElement("div");
    body.className = "key-confirm-body";
    body.textContent = message;

    const hint = document.createElement("div");
    hint.className = "key-confirm-hint";
    hint.textContent = "Press Y to delete / N to cancel";

    card.append(title, body, hint);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const k = typeof e.key === "string" ? e.key.toLowerCase() : "";
      if (k !== "y" && k !== "n" && k !== "escape") return;

      e.preventDefault();
      e.stopPropagation();
      cleanup();
      resolve(k === "y");
    };

    const cleanup = () => {
      window.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
    };

    window.addEventListener("keydown", onKeyDown, true);

    overlay.addEventListener("click", (ev) => {
      if (ev.target !== overlay) return;
      cleanup();
      resolve(false);
    });
  });
}

type DustDecision = "erase" | "restore" | "cancel";

function keyConfirmDust(message: string): Promise<DustDecision> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "key-confirm-overlay";

    const card = document.createElement("div");
    card.className = "key-confirm";

    const title = document.createElement("div");
    title.className = "key-confirm-title";
    title.textContent = "Dust";

    const body = document.createElement("div");
    body.className = "key-confirm-body";
    body.textContent = message;

    const hint = document.createElement("div");
    hint.className = "key-confirm-hint";
    hint.textContent = "Press Y to erase forever / N to restore / Esc to cancel";

    card.append(title, body, hint);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const k = typeof e.key === "string" ? e.key.toLowerCase() : "";
      if (k !== "y" && k !== "n" && k !== "escape") return;

      e.preventDefault();
      e.stopPropagation();
      cleanup();

      if (k === "y") resolve("erase");
      else if (k === "n") resolve("restore");
      else resolve("cancel");
    };

    const cleanup = () => {
      window.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
    };

    window.addEventListener("keydown", onKeyDown, true);

    overlay.addEventListener("click", (ev) => {
      if (ev.target !== overlay) return;
      cleanup();
      resolve("cancel");
    });
  });
}

function getShortcutDigit(e: KeyboardEvent): number | null {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const hasMod = isMac ? e.metaKey : e.ctrlKey;

  // Alt + Shift + Ctrl(Win) / ⌘(Mac) + 数字
  if (!e.altKey || !e.shiftKey || !hasMod) return null;

  if (e.code?.startsWith("Digit")) {
    const n = Number(e.code.slice("Digit".length));
    return Number.isFinite(n) ? n : null;
  }
  if (e.code?.startsWith("Numpad")) {
    const n = Number(e.code.slice("Numpad".length));
    return Number.isFinite(n) ? n : null;
  }

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
let msgHoldUntil = 0;

function calcMessageDurationMs(text: string): number {
  // 文字数が長いほど表示時間を伸ばす（短文は最低でも少し長め）
  const len = text.replace(/\s+/g, " ").trim().length;
  const auto = 2500 + len * 55; // 目安: 20文字=約3.6s / 60文字=約5.8s
  const min = 5000;
  const max = 20000;
  return Math.min(max, Math.max(min, auto));
}

function showMessage(text: string, ms?: number) {
  const msgText = qs<HTMLSpanElement>("#msgText");
  const duration = ms ?? calcMessageDurationMs(text);

  msgText.textContent = text;
  msgHoldUntil = Date.now() + duration;

  if (msgTimer) window.clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => {
    msgHoldUntil = 0;
    msgText.textContent = activeTab().dirty ? "Unsaved" : "";
  }, duration);
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
    tab.dirty = false;
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
        if (goDustHandler) void goDustHandler();
      } else if (digit === 9) {
        if (goExplorerHandler) void goExplorerHandler();
      } else if (digit >= 1 && digit <= 8) {
        if (switchTabHandler) void switchTabHandler(digit);
      }
    
      return;
    }

    if (isTogglePreviewWideShortcut(e)) {
      e.preventDefault();
      if (togglePreviewWideHandler) void togglePreviewWideHandler();
      return;
    }
    
    // --- Explorer/Dust: focus move & multi-select ---
    if (state.view === "explorer" || state.view === "dust") {
      if (isListSelectToggleShortcut(e)) {
        e.preventDefault();
        if (state.view === "explorer") {
          if (explorerSelectToggleHandler) void explorerSelectToggleHandler();
        } else {
          if (dustSelectToggleHandler) void dustSelectToggleHandler();
        }
        return;
      }

      const activeEl = document.activeElement;
      const isSearchTyping = activeEl instanceof HTMLInputElement && activeEl.id === "searchInput";

      if (!isSearchTyping && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const delta: -1 | 1 = e.key === "ArrowUp" ? -1 : 1;
        if (state.view === "explorer") {
          if (explorerMoveFocusHandler) void explorerMoveFocusHandler(delta);
        } else {
          if (dustMoveFocusHandler) void dustMoveFocusHandler(delta);
        }
        return;
      }

      if (!isSearchTyping && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === "Enter") {
        // Open focused memo only when nothing is selected
        if (state.view === "explorer") {
          if (state.explorerSelectedIds.size === 0 && explorerOpenFocusHandler) {
            e.preventDefault();
            void explorerOpenFocusHandler();
          }
        } else {
          if (state.dustSelectedIds.size === 0 && dustOpenFocusHandler) {
            e.preventDefault();
            void dustOpenFocusHandler();
          }
        }
        return;
      }
    }



    if (isExplorerSortShortcut(e)) {
      e.preventDefault();
      if (sortExplorerHandler) void sortExplorerHandler();
      return;
    }

    if (isNewShortcut(e)) {
      e.preventDefault();
      if (!newTabHandler) return;
    
      const before = state.tabs.length;
      try {
        await newTabHandler();
      } catch (err) {
        console.error("new tab failed", err);
        showMessage("Oops — failed to create a tab 😵‍💫", 2500);
        return;
      }
    
      // タブが増えたときだけメッセージ表示（MAX到達などは増えない）
      if (state.tabs.length > before) {
        const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
        const n = idx >= 0 ? idx + 1 : state.tabs.length;
        showMessage(`New tab 🆕 → Tab ${n}`);
      }
      return;
    }

    if (isDeleteShortcut(e)) {
      e.preventDefault();
      if (deleteMemoHandler) void deleteMemoHandler();
      return;
    }

    if (isCloseShortcut(e)) {
      e.preventDefault();
      if (closeTabHandler) void closeTabHandler();
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

  // --- pseudo tags (Input) ---
  const pseudoTagBar = qs<HTMLElement>("#presudoTagBar, #pseudoTagBar");
  const pseudoTagList = qs<HTMLDivElement>("#pseudoTagList");

  const tagSuggest = qs<HTMLDivElement>("#tagSuggest");

  const searchBar = qs<HTMLElement>("#searchBar");
  const searchInput = qs<HTMLInputElement>("#searchInput");
  const searchClearBtn = qs<HTMLButtonElement>("#searchClearBtn");

  const panes = qs<HTMLDivElement>("#editorView .panes");

  const inputPane = input.closest<HTMLElement>(".pane");
  if (!inputPane) throw new Error("input pane not found");

  let isPreviewWide = false;

  const applyPreviewWide = (on: boolean) => {
    // Input を隠す（CSSの [hidden] が display:none にする）
    inputPane.hidden = on;

    // Preview を全幅化（grid を 1列に）
    panes.style.gridTemplateColumns = on ? "1fr" : "";

    // フォーカス事故防止：Input を隠すなら blur、戻すなら focus
    if (on) {
      if (document.activeElement === input) input.blur();
    } else {
      input.focus();
    }
  };

  const focusEditorInputIfVisible = () => {
    if (state.view !== "editor") return;
    if (isPreviewWide) return;
    input.focus();
  };

  // 初期反映
  applyPreviewWide(isPreviewWide);

  // const reloadBtn = qs<HTMLButtonElement>("#reloadBtn");
  const listState = qs<HTMLSpanElement>("#listState");
  const memoList = qs<HTMLUListElement>("#memoList");
  
  // --- List focus / multi-select (Explorer & Dust) ---
  let explorerOrderedIds: string[] = [];
  let dustOrderedIds: string[] = [];
  let dustTotal = 0;

  // --- Search (Explorer & Dust) ---
  let explorerQuery = "";
  let dustQuery = "";
  let explorerAllSorted: MemoRow[] = [];
  let dustAll: MemoRow[] = [];

  const updateExplorerStateText = (visibleCount = explorerOrderedIds.length, totalCount = state.memos.length) => {
    const q = explorerQuery.trim();
    const base = `${totalCount} memos · ${sortLabel(state.explorerSortMode)} · Showing: ${visibleCount}`;
    const filter = q ? ` · Filter: "${q}"` : "";
    listState.textContent = `${base}${filter} · Selected: ${state.explorerSelectedIds.size}`;
  };

  const updateDustStateText = (visibleCount = dustOrderedIds.length, totalCount = dustTotal) => {
    const q = dustQuery.trim();
    const base = `${totalCount} trashed memos · Showing: ${visibleCount}`;
    const filter = q ? ` · Filter: "${q}"` : "";
    dustState.textContent = `${base}${filter} · Selected: ${state.dustSelectedIds.size}`;
  };

  const syncListClasses = (ul: HTMLUListElement, focusId: string | null, selected: Set<string>) => {
    const items = ul.querySelectorAll<HTMLLIElement>("li.memo-item");
    items.forEach((li) => {
      const id = li.dataset.id ?? "";
      li.classList.toggle("is-selected", selected.has(id));
      li.classList.toggle("is-focused", !!focusId && id === focusId);
    });
  };

  const scrollFocusIntoView = (ul: HTMLUListElement, focusId: string | null, behavior: ScrollBehavior = "smooth") => {
    if (!focusId) return;
    const esc = (globalThis as any).CSS?.escape ? (globalThis as any).CSS.escape(focusId) : focusId;
    const el = ul.querySelector<HTMLLIElement>(`li.memo-item[data-id="${esc}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior, block: "nearest" });
  };

  const ensureFocus = (orderedIds: string[], current: string | null): string | null => {
    if (orderedIds.length === 0) return null;
    if (!current || !orderedIds.includes(current)) return orderedIds[0];
    return current;
  };

  const moveFocus = (orderedIds: string[], current: string | null, delta: -1 | 1): string | null => {
    if (orderedIds.length === 0) return null;
    const curId = current ?? orderedIds[0];
    let idx = orderedIds.indexOf(curId);
    if (idx < 0) idx = 0;
    const next = Math.max(0, Math.min(orderedIds.length - 1, idx + delta));
    return orderedIds[next];
  };

  const toggleSelectAtFocus = (focusId: string | null, selected: Set<string>) => {
    if (!focusId) return;
    if (selected.has(focusId)) selected.delete(focusId);
    else selected.add(focusId);
  };

  const pruneSelection = (selected: Set<string>, idsInList: string[]) => {
    if (selected.size === 0) return;
    const set = new Set(idsInList);
    for (const id of Array.from(selected)) {
      if (!set.has(id)) selected.delete(id);
    }
  };

  const ensureExplorerFocus = () => {
    state.explorerFocusId = ensureFocus(explorerOrderedIds, state.explorerFocusId);
  };

  const ensureDustFocus = () => {
    state.dustFocusId = ensureFocus(dustOrderedIds, state.dustFocusId);
  };

  const moveExplorerFocus = (delta: -1 | 1) => {
    if (state.view !== "explorer") return;
    state.explorerFocusId = moveFocus(explorerOrderedIds, state.explorerFocusId, delta);
    syncListClasses(memoList, state.explorerFocusId, state.explorerSelectedIds);
    scrollFocusIntoView(memoList, state.explorerFocusId);
  };

  const moveDustFocus = (delta: -1 | 1) => {
    if (state.view !== "dust") return;
    state.dustFocusId = moveFocus(dustOrderedIds, state.dustFocusId, delta);
    syncListClasses(dustList, state.dustFocusId, state.dustSelectedIds);
    scrollFocusIntoView(dustList, state.dustFocusId);
  };

  const toggleExplorerSelectionAtFocus = () => {
    if (state.view !== "explorer") return;
    ensureExplorerFocus();
    toggleSelectAtFocus(state.explorerFocusId, state.explorerSelectedIds);
    syncListClasses(memoList, state.explorerFocusId, state.explorerSelectedIds);
    updateExplorerStateText();
    scrollFocusIntoView(memoList, state.explorerFocusId);
  };

  const toggleDustSelectionAtFocus = () => {
    if (state.view !== "dust") return;
    ensureDustFocus();
    toggleSelectAtFocus(state.dustFocusId, state.dustSelectedIds);
    syncListClasses(dustList, state.dustFocusId, state.dustSelectedIds);
    updateDustStateText();
    scrollFocusIntoView(dustList, state.dustFocusId);
  };


  // --- tab UX helpers (shortcut switching etc.)
const getTabLabel = (t: TabState) => memoTitleFromContent(t.text);

const scrollTabIntoView = (tabId: string, behavior: ScrollBehavior = "smooth") => {
  window.requestAnimationFrame(() => {
    const btn = Array.from(
      tabList.querySelectorAll<HTMLButtonElement>('button[data-tab-id]')
    ).find((b) => b.dataset.tabId === tabId);

    if (!btn) return;
    // Scroll only within the tab list (horizontal)
    btn.scrollIntoView({ behavior, block: "nearest", inline: "nearest" });
  });
};
  newTabHandler = async () => {
    if (state.tabs.length >= MAX_TABS) {
      showMessage(`Max ${MAX_TABS} tabs — close one to add.`);
      return;
    }
    await createNewTab();
  };

  switchTabHandler = async (digit: number) => {
    const i = digit - 1;
    const target = state.tabs[i];
  
    if (!target) {
      showMessage(`No tab for shortcut ${digit}.`);
      return;
    }
  
    if (target.id === state.activeTabId) {
      // Explorer/Dustにいる場合は「同じタブに戻る＝Editorへ戻る」として扱う
      scrollTabIntoView(target.id);
      if (state.view !== "editor") {
        await activateTab(target.id); // setView("editor") が走る → 選択解除も発火
        showMessage(`Back → Tab ${digit}: ${getTabLabel(target)}`);
      } else {
        showMessage(`Already on Tab ${digit}: ${getTabLabel(target)}`);
      }
      return;
    }
  
    let saveResult: SaveResult = "noop";
    try {
      saveResult = await saveIfDirty(); // 未保存なら保存してから切替
    } catch (err) {
      console.error("save failed before switching tab", err);
      showMessage("Oops — save failed 😵‍💫", 2500);
      return; // 保存失敗 → 切替しない
    }
  
    await activateTab(target.id);
  
    const title = getTabLabel(target);
    if (saveResult === "updated") showMessage(`Updated ✨ → Tab ${digit}: ${title}`);
    else if (saveResult === "created") showMessage(`Created 🚀 → Tab ${digit}: ${title}`);
    else showMessage(`Switched → Tab ${digit}: ${title}`);
  };
  
  function renderTabs() {
    const reached = state.tabs.length >= MAX_TABS;
    newTabBtn.disabled = reached;
    newTabBtn.setAttribute("aria-disabled", String(reached));
    newTabBtn.title = reached ? `Max ${MAX_TABS} tabs (close one to add)` : "New Memo";

    tabList.innerHTML = state.tabs
    .map((t, idx) => {
      const n = idx + 1;
      const key = n <= 8 ? String(n) : "";
      const prefix = key ? `${key}: ` : "";
      const baseMax = key ? Math.max(6, TAB_TITLE_MAX - prefix.length) : TAB_TITLE_MAX;

      const baseLabel = extractFirstLineTitle(t.text, baseMax);
      const dirtyMark = t.dirty ? " *" : "";
      const display = `${prefix}${baseLabel}${dirtyMark}`;

      const isActive = t.id === state.activeTabId;
      const tip = key
        ? `Tab ${n}: ${baseLabel} (Alt+Shift+Ctrl+${n})`
        : `Tab ${n}: ${baseLabel}`;

      return `
        <button
          class="tab ${isActive ? "is-active" : ""}"
          type="button"
          role="tab"
          data-tab-id="${escapeHtml(t.id)}"
          aria-selected="${isActive ? "true" : "false"}"
          title="${escapeHtml(tip)}"
          aria-label="${escapeHtml(tip)}"
        >${escapeHtml(display)}</button>
      `;
    })
    .join("");
  }  
  
  async function activateTab(tabId: string) {
    // タブ切替時に「保存したい」ならここに saveIfDirty() を入れる
    state.activeTabId = tabId;
    renderEditor();     // active tab の内容を editor に流し込む
    renderTabs();       // active 表示更新
    setView("editor");
    scrollTabIntoView(tabId);
    // input.focus();
    focusEditorInputIfVisible();
  }


  async function createNewTab() {
    if (state.tabs.length >= MAX_TABS) {
      showMessage(`MAX ${MAX_TABS} tabs - close one to add.`);
      return;      
    }

    const id = crypto.randomUUID();
    state.tabs.push({ id, text: DEFAULT_TEXT, dirty: false, currentMemoId: null });
    await activateTab(id);
  }
  
  tabList.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>("button[data-tab-id]");
    const tabId = btn?.getAttribute("data-tab-id");
    if (!tabId) return;
    void activateTab(tabId);
  });
  

  function syncSearchUi() {
    const isExplorer = state.view === "explorer";
    const isDust = state.view === "dust";
    const show = isExplorer || isDust;

    if (!show) {
      if (document.activeElement === searchInput) searchInput.blur();
      searchBar.hidden = true;
      searchInput.disabled = true;
      searchClearBtn.hidden = true;
      return;
    }

    searchBar.hidden = false;
    searchInput.disabled = false;

    if (isExplorer) {
      searchInput.placeholder = "Search in Explorer...";
      searchInput.value = explorerQuery;
    } else {
      searchInput.placeholder = "Search in Dust...";
      searchInput.value = dustQuery;
    }

    searchClearBtn.hidden = searchInput.value.trim().length === 0;
  }

  function setView(view: ViewMode) {
    const prev = state.view;

    // Clear list selections when leaving Explorer/Dust
    if (prev === "explorer" && view !== "explorer") {
      if (state.explorerSelectedIds.size > 0) {
        state.explorerSelectedIds.clear();
        syncListClasses(memoList, state.explorerFocusId, state.explorerSelectedIds);
        updateExplorerStateText();
      }
    }
    if (prev === "dust" && view !== "dust") {
      if (state.dustSelectedIds.size > 0) {
        state.dustSelectedIds.clear();
        syncListClasses(dustList, state.dustFocusId, state.dustSelectedIds);
        updateDustStateText();
      }
    }

    state.view = view;

    syncSearchUi();
  
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
    
    // Keep state text in sync
    if (isExplorer) updateExplorerStateText();
    if (isDust) updateDustStateText();
    if (isEditor) applyPreviewWide(isPreviewWide);
  }
  
  let msgTimer: number | undefined;
  let msgHoldUntil = 0;

  function calcMessageDurationMs(text: string): number {
    const len = text.replace(/\s+/g, " ").trim().length;
    const auto = 2500 + len * 55;
    const min = 5000;
    const max = 20000;
    return Math.min(max, Math.max(min, auto));
  }

  function showMessage(text: string, ms?: number) {
    const duration = ms ?? calcMessageDurationMs(text);

    msgText.textContent = text;
    msgHoldUntil = Date.now() + duration;

    if (msgTimer) window.clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => {
      msgHoldUntil = 0;
      msgText.textContent = activeTab().dirty ? "Unsaved" : "";
    }, duration);
  }

  togglePreviewWideHandler = async () => {
    if (state.view !== "editor") {
      showMessage("Preview wide is available in Editor.");
      return;
    }
  
    isPreviewWide = !isPreviewWide;
    applyPreviewWide(isPreviewWide);
    showMessage(isPreviewWide ? "Preview: Wide" : "Preview: Split");
  };

  function setDirty(next: boolean) {
    activeTab().dirty = next;

    // メッセージ表示中は "Unsaved" で上書きしない（読み切る時間を確保）
    if (Date.now() < msgHoldUntil) return;
    msgText.textContent = activeTab().dirty ? "Unsaved" : "";
  }


  // --- pseudo tags: extract from input text and show as chips ---
  const renderPseudoTags = (text: string) => {
    const tags = extractPseudoTags(text);

    if (tags.length === 0) {
      pseudoTagBar.hidden = true;
      pseudoTagList.innerHTML = "";
      return;
    }

    pseudoTagBar.hidden = false;
    pseudoTagList.innerHTML = tags
      .map((t) => {
        const esc = escapeHtml(t);
        return `<button class="tagchip" type="button" data-tag="${esc}">#${esc}</button>`;
      })
      .join("");
  };

  // Click a tag chip to copy "#tag" (safe / no state changes)
  pseudoTagList.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>("button.tagchip");
    const tag = btn?.dataset.tag;
    if (!tag) return;

    const text = `#${tag}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showMessage(`Copied ${text}`),
        () => showMessage(`Tag: ${text}`)
      );
    } else {
      showMessage(`Tag: ${text}`);
    }
  });


// --- Tag suggestions (autocomplete) ---
type TagEntry = { key: string; display: string; count: number; lastSeen: number };

const normalizeTagKey = (s: string) => (/[A-Za-z]/.test(s) ? s.toLowerCase() : s);

let tagDict: TagEntry[] = [];
let tagDictBuiltAt = 0;

const rebuildTagDict = () => {
  const map = new Map<string, TagEntry>();

  const addFromText = (text: string, ts: number) => {
    for (const raw of extractPseudoTags(text)) {
      const key = normalizeTagKey(raw);
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { key, display: raw, count: 1, lastSeen: ts });
      } else {
        prev.count += 1;
        if (ts > prev.lastSeen) prev.lastSeen = ts;
      }
    }
  };

  const now = Date.now();
  // Explorer memos
  for (const m of state.memos) {
    const t = Date.parse(m.updated_at ?? m.created_at) || now;
    addFromText(m.content ?? "", t);
  }
  // Dust memos (if already loaded)
  for (const m of dustAll) {
    const t = Date.parse(m.updated_at ?? m.created_at) || now;
    addFromText(m.content ?? "", t);
  }
  // Open tabs (unsaved tags should still be suggested)
  for (const t of state.tabs) addFromText(t.text ?? "", now);

  tagDict = Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen;
    return a.display.localeCompare(b.display);
  });

  tagDictBuiltAt = now;
};

const suggestTags = (prefixRaw: string, limit = 8): TagEntry[] => {
  if (!tagDictBuiltAt) rebuildTagDict();
  const prefix = normalizeTagKey(prefixRaw);
  if (!prefix) return tagDict.slice(0, limit);
  const out: TagEntry[] = [];
  for (const t of tagDict) {
    if (t.key.startsWith(prefix)) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
};

const findActiveTagToken = (value: string, cursor: number): { hashPos: number; prefix: string } | null => {
  if (cursor <= 0) return null;

  // Walk left over allowed tag chars
  let i = cursor - 1;
  while (i >= 0) {
    const ch = value[i];
    if (/[\p{L}\p{N}_-]/u.test(ch)) {
      i -= 1;
      continue;
    }
    break;
  }

  if (i < 0 || value[i] !== "#") return null;
  const hashPos = i;

  // "# aiueo" is heading; do not suggest
  const afterHash = value[hashPos + 1] ?? "";
  if (afterHash === "" || /\s/.test(afterHash)) return null;

  // avoid matching inside a word: "abc#tag"
  const before = hashPos > 0 ? value[hashPos - 1] : "";
  if (before && /[\p{L}\p{N}_-]/u.test(before)) return null;

  const prefix = value.slice(hashPos + 1, cursor);
  return { hashPos, prefix };
};

let suggestItems: TagEntry[] = [];
let suggestIndex = 0;
let suppressSuggestOnce = false;

const closeTagSuggest = () => {
  tagSuggest.hidden = true;
  tagSuggest.innerHTML = "";
  suggestItems = [];
  suggestIndex = 0;
};

const renderTagSuggest = () => {
  if (suggestItems.length === 0) {
    closeTagSuggest();
    return;
  }

  tagSuggest.hidden = false;
  tagSuggest.innerHTML = suggestItems
    .map((t, idx) => {
      const esc = escapeHtml(t.display);
      const active = idx === suggestIndex ? " is-active" : "";
      return `<button class="tag-suggest-item${active}" type="button" role="option" aria-selected="${idx === suggestIndex}" data-idx="${idx}" data-tag="${esc}"><span>#${esc}</span><span class="tag-suggest-hint">Tab/Enter</span></button>`;
    })
    .join("");
};

const applyTagSuggestion = (entry: TagEntry) => {
  const cursor = input.selectionStart ?? 0;
  const found = findActiveTagToken(input.value, cursor);
  if (!found) return;

  const start = found.hashPos;
  const end = cursor;

  const v = input.value;
  const tail = v.slice(end);

  // Insert the chosen tag. Also add a trailing space to "finish" the token so
  // the suggest popup won't immediately reopen on keyup.
  const core = `#${entry.display}`;
  const needsSpace = tail.length === 0 ? true : !/^\s/.test(tail);
  const ins = core + (needsSpace ? " " : "");

  input.value = v.slice(0, start) + ins + v.slice(end);
  const newPos = start + ins.length;
  input.setSelectionRange(newPos, newPos);

  // trigger normal render pipeline
  suppressSuggestOnce = true;
  input.dispatchEvent(new Event("input"));
  closeTagSuggest();

  // Allow suggestions again on next tick (prevents immediate reopen on Enter)
  window.setTimeout(() => {
    suppressSuggestOnce = false;
  }, 0);
};


const updateTagSuggest = () => {
  if (state.view !== "editor") {
    closeTagSuggest();
    return;
  }

  if (suppressSuggestOnce) {
    closeTagSuggest();
    return;
  }

  const cursor = input.selectionStart ?? 0;
  const found = findActiveTagToken(input.value, cursor);
  if (!found) {
    closeTagSuggest();
    return;
  }

  // Show suggestions when user typed at least 1 char after '#'
  if (found.prefix.trim().length < 1) {
    closeTagSuggest();
    return;
  }

  // Rebuild occasionally (cheap, but avoid per-keystroke rebuild)
  if (Date.now() - tagDictBuiltAt > 10_000) rebuildTagDict();

  const items = suggestTags(found.prefix, 8);
  if (items.length === 0) {
    closeTagSuggest();
    return;
  }

  suggestItems = items;
  suggestIndex = Math.min(suggestIndex, suggestItems.length - 1);
  renderTagSuggest();
};

// Keep textarea focus when clicking suggestions
tagSuggest.addEventListener("mousedown", (e) => e.preventDefault());

tagSuggest.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement | null;
  const btn = target?.closest<HTMLButtonElement>("button.tag-suggest-item");
  const idxStr = btn?.dataset.idx;
  if (idxStr == null) return;
  const idx = Number(idxStr);
  const entry = suggestItems[idx];
  if (!entry) return;
  applyTagSuggestion(entry);
});

input.addEventListener("blur", () => closeTagSuggest());

input.addEventListener("keydown", (e) => {
  if (tagSuggest.hidden) return;

  // Don't interfere with IME composition
  if ((e as any).isComposing) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    suggestIndex = Math.min(suggestIndex + 1, suggestItems.length - 1);
    renderTagSuggest();
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    suggestIndex = Math.max(suggestIndex - 1, 0);
    renderTagSuggest();
    return;
  }
  if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    e.stopPropagation();

    const entry = suggestItems[suggestIndex];
    if (entry) applyTagSuggestion(entry);
    else closeTagSuggest();

    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeTagSuggest();
    return;
  }
});


// Update suggestions when caret moves (←/→) or user clicks inside textarea
input.addEventListener("keyup", () => updateTagSuggest());
input.addEventListener("click", () => updateTagSuggest());
  // ---- renderers
  function renderEditor() {

    const tab = activeTab();
    input.value = tab.text;
    // preview.innerHTML = renderPreviewText(tab.text);
    preview.innerHTML = renderPreviewMarkdown(tab.text);
    if (tab.dirty) msgText.textContent = "Unsaved";
    renderPseudoTags(tab.text);
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
        const size = formatBytes(memoSizeBytes(m.content));
        const id = escapeHtml(m.id);
        return `
          <li class="memo-item" data-id="${id}" style="border:1px solid #e3e6ea; border-radius:12px; padding:10px; margin-bottom:10px;">
            <button class="memo-row" data-id="${id}" type="button" style="all:unset; cursor:pointer; display:block; width:100%;">
              <div style="font-weight:700;">${title}</div>
              <div style="font-size:12px; color:#666; margin-top:6px;">
                <div>Created Date:  ${created}</div>
                <div>Updated Date:  ${updated}</div>
                <div>Size:          ${size}</div>
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
        const id = escapeHtml(m.id);
        return `
          <li class="memo-item" data-id="${id}" style="border:1px solid #e3e6ea; border-radius:12px; padding:10px; margin-bottom:10px;">
            <button class="memo-row" data-id="${id}" type="button"
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

    if (mode === 4) {
      // 4) サイズ順（大きい順）
      return [...list].sort((a, b) => {
        const sa = memoSizeBytes(a.content);
        const sb = memoSizeBytes(b.content);
        if (sb !== sa) return sb - sa; // 大きい順
        // サイズが同じなら新しい作成日を優先（安定化）
        const da = Date.parse(a.created_at);
        const db = Date.parse(b.created_at);
        return db - da;
      });
    }

    // 3) アップロード順（新しい順）= created_at desc
    return [...list].sort((a, b) => {
      const da = Date.parse(a.created_at);
      const db = Date.parse(b.created_at);
      return db - da;
    });
  }

  function sortLabel(mode: 0 | 1 | 2 | 3 | 4) {
    if (mode === 1) return "Sort: Title (A→あ)";
    if (mode === 2) return "Sort: Updated (newest)";
    if (mode === 3) return "Sort: Uploaded (newest)";
    if (mode === 4) return "Sort: Size (largest)";
    return "Sort: (not set)";
  }



  const normalizeQuery = (q: string) => q.trim().toLowerCase();

  const memoMatchesQuery = (m: MemoRow, q: string) => {
    if (!q) return true;
    const hay = (m.content ?? "").toLowerCase();
    return hay.includes(q);
  };

  const applyExplorerRender = (behavior: ScrollBehavior = "auto") => {
    const q = normalizeQuery(explorerQuery);
    const base = explorerAllSorted;
    const filtered = q ? base.filter((m) => memoMatchesQuery(m, q)) : base;

    explorerOrderedIds = filtered.map((m) => m.id);

    pruneSelection(state.explorerSelectedIds, explorerOrderedIds);
    state.explorerFocusId = ensureFocus(explorerOrderedIds, state.explorerFocusId);

    if (filtered.length === 0) {
      memoList.innerHTML = q
        ? `<li style="padding:10px; color:#666;">(no matches)</li>`
        : `<li style="padding:10px; color:#666;">(empty)</li>`;
    } else {
      renderExplorer(filtered);
    }

    updateExplorerStateText(filtered.length, base.length);
    syncListClasses(memoList, state.explorerFocusId, state.explorerSelectedIds);
    scrollFocusIntoView(memoList, state.explorerFocusId, behavior);
  };

  const applyDustRender = (behavior: ScrollBehavior = "auto") => {
    const q = normalizeQuery(dustQuery);
    const base = dustAll;
    const filtered = q ? base.filter((m) => memoMatchesQuery(m, q)) : base;

    dustOrderedIds = filtered.map((m) => m.id);

    pruneSelection(state.dustSelectedIds, dustOrderedIds);
    state.dustFocusId = ensureFocus(dustOrderedIds, state.dustFocusId);

    if (filtered.length === 0) {
      dustList.innerHTML = q
        ? `<li style="padding:10px; color:#666;">(no matches)</li>`
        : `<li style="padding:10px; color:#666;">(empty)</li>`;
    } else {
      renderDust(filtered);
    }

    updateDustStateText(filtered.length, dustTotal);
    syncListClasses(dustList, state.dustFocusId, state.dustSelectedIds);
    scrollFocusIntoView(dustList, state.dustFocusId, behavior);
  };

  async function loadExplorer() {
    try {
      listState.textContent = "Loading...";
      const userId = await requireUserId();
      const list = await listMemos({ userId, limit: 50 });

      state.memos = list;

      explorerAllSorted = getSortedExplorerList(list);
      applyExplorerRender("auto");
      rebuildTagDict();
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

      dustAll = list;
      dustTotal = list.length;

      applyDustRender("auto");
      rebuildTagDict();
    } catch (e) {
      console.error(e);
      dustState.textContent = "Failed to load";
      dustList.innerHTML = `<li style="padding:10px; color:#b00020;">Failed to load.</li>`;
    }
  }

  // ---- wire editor
  renderEditor();
  renderTabs();


  // ---- wire search (Explorer & Dust)
  searchInput.addEventListener("input", () => {
    const v = searchInput.value;

    if (state.view === "explorer") {
      explorerQuery = v;
      applyExplorerRender("auto");
    } else if (state.view === "dust") {
      dustQuery = v;
      applyDustRender("auto");
    }

    searchClearBtn.hidden = v.trim().length === 0;
  });

  searchClearBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input"));
    searchInput.focus();
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (searchInput.value.trim().length > 0) {
      e.preventDefault();
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
      return;
    }

    // empty: leave search
    searchInput.blur();
  });


  input.addEventListener("input", () => {
    activeTab().text = input.value;
    setDirty(true);
    // preview.innerHTML = renderPreviewText(activeTab().text);
    preview.innerHTML = renderPreviewMarkdown(activeTab().text);
    renderPseudoTags(input.value);
    renderTabs();
  });

  // Tag autocomplete
  input.addEventListener("input", () => updateTagSuggest());

  // ---- wire explorer
  // reloadBtn.addEventListener("click", async () => {
  //   await loadExplorer();
  // });

  memoList.addEventListener("click", async (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>("button.memo-row");
    const id = btn?.dataset.id;
    if (!id) return;

    // Keep a stable keyboard focus point for ↑/↓ and Space
    state.explorerFocusId = id;
    syncListClasses(memoList, state.explorerFocusId, state.explorerSelectedIds);
    scrollFocusIntoView(memoList, state.explorerFocusId, "auto");

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

  // ---- wire dust (erase forever / restore)
  dustList.addEventListener("click", async (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>("button.memo-row");
    const id = btn?.dataset.id;
    if (!id) return;
    
    // Keep a stable keyboard focus point for ↑/↓ and Space
    state.dustFocusId = id;
    syncListClasses(dustList, state.dustFocusId, state.dustSelectedIds);
    scrollFocusIntoView(dustList, state.dustFocusId, "auto");

    try {
      const userId = await requireUserId();
      const memo = await getMemo({ userId, id });
      if (!memo) return;

      const title = memoTitleFromContent(memo.content);
      const decision = await keyConfirmDust(
        `"${title}"\n\nErase forever? (Y)\nRestore to Explorer? (N)`
      );

      if (decision === "erase") {
        await hardDeleteMemo({ userId, id });

        showMessage("Deleted forever 🔥");
        await loadDust();       // Dust を再描画
        setView("dust");
        return;
      }

      if (decision === "restore") {
        await restoreMemo({ userId, id });

        showMessage("Restored ✨");
        await goExplorer();     // Explorer を開いて一覧を再描画
        setView("dust");

        void loadExplorer();
        return;
      }

      showMessage("Canceled.");
    } catch (e) {
      console.error(e);
      showMessage("Oops — action failed 😵‍💫", 2500);
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
  goDustHandler = goDust;
  
  // keyboard handlers for list focus / selection / open
  explorerSelectToggleHandler = async () => {
    if (state.view !== "explorer") return;
    toggleExplorerSelectionAtFocus();
  };

  explorerMoveFocusHandler = async (delta: -1 | 1) => {
    if (state.view !== "explorer") return;
    ensureExplorerFocus();
    moveExplorerFocus(delta);
  };

  explorerOpenFocusHandler = async () => {
    if (state.view !== "explorer") return;
    ensureExplorerFocus();
    const id = state.explorerFocusId;
    if (!id) return;

    try {
      await saveIfDirty();
      const userId = await requireUserId();
      const memo = await getMemo({ userId, id });
      if (!memo) return;

      activeTab().currentMemoId = memo.id;
      activeTab().text = memo.content;
      setDirty(false);

      renderEditor();
      renderTabs();
      setView("editor");
    } catch (e) {
      console.error(e);
    }
  };

  dustSelectToggleHandler = async () => {
    if (state.view !== "dust") return;
    toggleDustSelectionAtFocus();
  };

  dustMoveFocusHandler = async (delta: -1 | 1) => {
    if (state.view !== "dust") return;
    ensureDustFocus();
    moveDustFocus(delta);
  };
  
  dustOpenFocusHandler = async () => {
    if (state.view !== "dust") return;
    ensureDustFocus();
    const id = state.dustFocusId;
    if (!id) return;

    try {
      await saveIfDirty();
      const userId = await requireUserId();
      const memo = await getMemo({ userId, id });
      if (!memo) return;

      activeTab().currentMemoId = memo.id;
      activeTab().text = memo.content;
      setDirty(false);

      renderEditor();
      renderTabs();
      setView("editor");
    } catch (e) {
      console.error(e);
    }
  };

  closeTabHandler = async () => {
    const viewBefore = state.view;
  
    try {
      const tab = activeTab();
      const title = extractFirstLineTitle(tab.text, TAB_TITLE_MAX);
  
      // 未保存なら保存してから閉じる
      // const needsSave = tab.dirty || (tab.currentMemoId === null && tab.text.trim() !== "");
      // if (needsSave) {
      //   const userId = await requireUserId();
  
      //   if (tab.currentMemoId) {
      //     await updateMemo({ userId, id: tab.currentMemoId, content: tab.text });
      //   } else {
      //     const created = await createMemo({ userId, content: tab.text });
      //     tab.currentMemoId = created.id;
      //   }
  
      //   tab.dirty = false;
      // }
  
      // 未保存なら保存してから閉じる
      // 新規タブ（currentMemoId === null）の場合、DEFAULT_TEXTのまま or 白紙なら保存しない
      const norm = (s: string) => s.replaceAll("\r\n", "\n").trim();
      const isNew = tab.currentMemoId === null;
      const isBlankDraft = isNew && norm(tab.text) === "";
      const isDefaultDraft = isNew && norm(tab.text) === norm(DEFAULT_TEXT);
      const needsSave = isNew ? (!isBlankDraft && !isDefaultDraft) : tab.dirty;

      const idx = state.tabs.findIndex((t) => t.id === tab.id);
      if (idx < 0) return;
  
      // 最後の1枚なら「空の新規タブ」に置き換える
      if (state.tabs.length === 1) {
        const newId = crypto.randomUUID();
        state.tabs = [{ id: newId, text: "", dirty: false, currentMemoId: null }];
        state.activeTabId = newId;
  
        renderEditor();
        renderTabs();
        setView(viewBefore);
        // if (viewBefore === "editor") input.focus();
        if (viewBefore === "editor") focusEditorInputIfVisible();
  
        showMessage(needsSave ? `Saved & closed: ${title}` : `Closed: ${title}`);
        return;
      }
  
      // タブ削除 → 次のアクティブを決定
      state.tabs.splice(idx, 1);
      const next = state.tabs[Math.max(0, idx - 1)];
      state.activeTabId = next.id;
  
      // 表示更新（ビューは維持）
      renderTabs();
      if (viewBefore === "editor") {
        renderEditor();
        // input.focus();
        focusEditorInputIfVisible();
      }
      setView(viewBefore);
  
      showMessage(needsSave ? `Saved & closed: ${title}` : `Closed: ${title}`);
    } catch (err) {
      console.error("close tab failed", err);
      showMessage("Oops — close tab failed 😵‍💫", 2500);
    }
  }; 
  
  deleteMemoHandler = async () => {
    // Explorer: move selected memos to Dust
    if (state.view === "explorer") {
      const count = state.explorerSelectedIds.size;
      if (count === 0) {
        showMessage("Select memo(s) with Alt+Shift+Ctrl+Space.");
        return;
      }

      const ok = await keyConfirm(`Move ${count} memo${count === 1 ? "" : "s"} to Dust?`);
      if (!ok) {
        showMessage("Canceled.");
        return;
      }

      try {
        await autoUpdateIfEditingCurrentMemo();
        const userId = await requireUserId();
        // sequential for safety
        for (const id of Array.from(state.explorerSelectedIds)) {
          await trashMemo({ userId, id });
        }

        state.explorerSelectedIds.clear();
        updateExplorerStateText();
        showMessage("Moved to Dust 🗑️");
        await goDust();
      } catch (err) {
        console.error("delete failed", err);
        showMessage("Oops — delete failed 😵‍💫", 2500);
      }
      return;
    }

    // Dust: erase forever / restore selected memos
    if (state.view === "dust") {
      const count = state.dustSelectedIds.size;
      if (count === 0) {
        showMessage("Select memo(s) with Alt+Shift+Ctrl+Space.");
        return;
      }

      const decision = await keyConfirmDust(
        `${count} memo${count === 1 ? "" : "s"} selected.\n\nErase forever? (Y)\nRestore to Explorer? (N)`
      );

      if (decision === "cancel") {
        showMessage("Canceled.");
        return;
      }

      try {
        const userId = await requireUserId();

        // sequential for safety
        if (decision === "erase") {
          for (const id of Array.from(state.dustSelectedIds)) {
            await hardDeleteMemo({ userId, id });
          }
          state.dustSelectedIds.clear();
          showMessage("Deleted forever 🔥");
          await loadDust();
          setView("dust");
          return;
        }

        // decision === "restore"
        for (const id of Array.from(state.dustSelectedIds)) {
          await restoreMemo({ userId, id });
        }
        state.dustSelectedIds.clear();
        showMessage("Restored ✨");
        await loadDust();
        setView("dust");
      } catch (err) {
        console.error("dust action failed", err);
        showMessage("Oops — action failed 😵‍💫", 2500);
      }
      return;
    }

    if (state.view !== "editor") {
      showMessage("Delete is available in Editor / Explorer / Dust.");
      return;
    }

    const tab = activeTab();
    if (!tab.currentMemoId) {
      showMessage("Nothing to delete — save the memo first.");
      return;
    }
  
    const title = memoTitleFromContent(tab.text);
    const ok = await keyConfirm(`Move "${title}" to Dust?`);
    if (!ok) {
      showMessage("Canceled.");
      return;
    }
  
    try {
      await autoUpdateIfEditingCurrentMemo(); // dirtyなら更新してから捨てる
      const userId = await requireUserId();
      await trashMemo({ userId, id: tab.currentMemoId });
  
      tab.currentMemoId = null;
      tab.text = "";
      tab.dirty = false;
  
      renderEditor();
      renderTabs();
  
      showMessage("Moved to Dust 🗑️");
      await goDust(); // 捨てた後にDUST表示
    } catch (err) {
      console.error("delete failed", err);
      showMessage("Oops — delete failed 😵‍💫", 2500);
    }
  };

  sortExplorerHandler = async () => {
    // Explorer 以外で押されたら事故防止：何もしないで案内だけ
    if (state.view !== "explorer") {
      showMessage("Sort is available in Explorer.");
      return;
    }
  
    // 1 → 2 → 3 → 4 → 1 ... （0からなら最初は1）
    state.explorerSortMode = ((state.explorerSortMode % 4) + 1) as 1 | 2 | 3 | 4;
  
    // まだ未ロードなら読み込む（空配列のまま押された時用）
    if (state.memos.length === 0) {
      await loadExplorer();
      showMessage(sortLabel(state.explorerSortMode));
      return;
    }

    explorerAllSorted = getSortedExplorerList(state.memos);
    applyExplorerRender("auto");
  
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
    // input.focus();
    focusEditorInputIfVisible();
  }

  // newTabBtn.addEventListener("click", () => void createNewTab());

  newTabBtn.addEventListener("click", () => {
    if (newTabHandler) void newTabHandler();
    else void createNewTab();
  });

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
  goDustHandler = null;
  newTabHandler = null;
  sortExplorerHandler = null;
  deleteMemoHandler = null;
  closeTabHandler = null;
  switchTabHandler = null;
  togglePreviewWideHandler = null;

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
