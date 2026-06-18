import { getSession, getUser, signOut } from "../../repos/authRepo";
import { supabase } from "../../lib/supabaseClient";
import {
  createMemo,
  getMemo,
  listMemos,
  listAllMemoContents,
  listDustMemos,
  updateMemo,
  trashMemo,
  restoreMemo,
  hardDeleteMemo,
  type MemoRow,
  type MemoContentRow,
} from "../../repos/supabaseMemoRepo";

import memoUIHtml from "../../templates/memoUI.html?raw";

import { renderPreviewMarkdown } from "../../markdown/previewMarkdown";
import {
  isSaveShortcut,
  isExplorerSortShortcut,
  isListSelectToggleShortcut,
  isNewShortcut,
  isDeleteShortcut,
  isCloseShortcut,
  getRelativeTabShortcutDelta,
  isTogglePreviewWideShortcut,
  isToggleEditWideShortcut,
  isSearchShortcut,
  isHeadingPopupShortcut,
  isAccountSettingsShortcut,
  isFeedbackShortcut,
  getShortcutDigit,
} from "../../shortcuts/shortcutPredicates";
import { getLineStartIndex, registerTextareaEditing } from "../../editor/textareaEditing";
import { escapeHtml } from "../../utils/html";
import { qs } from "../../utils/dom";
import { t } from "../../i18n/i18n";
import { submitFeedback } from "../../repos/feedbackRepo";
import { trackEvent } from "../../repos/analyticsRepo";
import {
  getAppScreen,
  openAccountScreen,
  openAccountSettingsScreen,
  openMemoScreen,
  setAppScreen,
} from "../auth/authScreens";

export type MountMemoUIDeps = {
  rerender: () => Promise<void>;
};

type ViewMode = "editor" | "explorer" | "dust";

type TabState = {
  id: string;
  mode: ViewMode;
  text: string;
  dirty: boolean;
  currentMemoId: string | null;
  returnToTabId: string | null;
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

const DEFAULT_TEXT = `# Shortcut Help

このメモはショートカット一覧です。
Mac では Ctrl を ⌘、Alt を Option と読み替えてください。

# Global shortcuts

## Save

- Alt + Ctrl + S / Option + ⌘ + S = Save current memo
  - 未ログインの場合は Sign up 確認を表示します。

## Tabs

- Alt + Shift + Ctrl/⌘ + 1-8 = Switch to tab 1-8
- Alt + Shift + Ctrl/⌘ + 9 = Open / switch to Explorer tab
- Alt + Shift + Ctrl/⌘ + 0 = Open / switch to Dust tab
- Alt + Shift + Ctrl/⌘ + [ = Switch to left tab
- Alt + Shift + Ctrl/⌘ + ] = Switch to right tab
- Alt + Shift + Ctrl/⌘ + T = Create a new memo tab
- Alt + Shift + Ctrl/⌘ + W = Close current tab

## Editor layout

- Alt + Shift + Ctrl/⌘ + V = Toggle Preview Wide
  - Preview を広く表示し、Input を隠す / 戻す。
- Alt + Shift + Ctrl/⌘ + E = Toggle Edit Wide
  - Input を広く表示し、Preview を隠す / 戻す。

## Search / heading jump

- Alt + Shift + Ctrl/⌘ + F = Search current place
  - Editor: open memo search popup.
  - Explorer / Dust: focus the list search box.
- Alt + Shift + Ctrl/⌘ + I = Open heading list popup
  - Editor 内の # / ## / ### 見出しへジャンプします。

## Account

- Alt + Shift + Ctrl/Cmd + A = Open account settings

## Delete / Dust actions

- Alt + Shift + Ctrl/⌘ + D = Delete / Dust action
  - Editor: move current saved memo to Dust.
  - Explorer: move selected memo(s) to Dust.
  - Dust: choose erase forever or restore selected memo(s).

## Explorer sort

- Alt + Shift + Ctrl/⌘ + O = Change Explorer sort order
  - Explorer でのみ有効です。

# Explorer / Dust list shortcuts

- Arrow Up / Arrow Down = Move focused memo
  - Search box 入力中は検索文字の移動を優先します。
- Alt + Shift + Ctrl/⌘ + Space = Toggle selection of focused memo
- Enter = Open focused memo when no memo is selected
  - Explorer: open the memo.
  - Dust: confirm restore, then open the memo.

# Editor textarea shortcuts

- Tab = Insert tab / indent
  - 通常行: カーソル位置にタブ文字を挿入します。
  - Markdown list line: 行頭にタブ文字を追加して入れ子にします。
  - 選択範囲あり: 選択行をまとめてインデントします。
- Shift + Tab = Outdent
  - 行頭のタブ文字を 1 段階戻します。
  - 選択範囲あり: 選択行をまとめてアウトデントします。
- Ctrl/⌘ + Z = Undo textarea edit
  - Tab / Shift + Tab による編集履歴がある場合、それを戻します。
  - 履歴がない場合はブラウザ標準の Undo に任せます。

# Tag suggestion popup

タグ候補が表示されている間だけ有効です。

- Arrow Down = Move to next tag suggestion
- Arrow Up = Move to previous tag suggestion
- Enter = Apply focused tag suggestion
- Tab = Apply focused tag suggestion
- Escape = Close tag suggestion popup

# Memo search popup

Alt + Shift + Ctrl/⌘ + F で Editor から開いた検索 popup 内で有効です。

- Arrow Down = Move to next search result
- Arrow Up = Move to previous search result
- Enter = Jump to focused search result
- Escape = Close search popup

# Heading list popup

Alt + Shift + Ctrl/⌘ + I で開いた heading popup 内で有効です。

- Arrow Down = Move to next heading
- Arrow Up = Move to previous heading
- Enter = Jump to focused heading
- Escape = Close heading popup

# Explorer / Dust search box

Explorer / Dust の検索 box にフォーカスしているときだけ有効です。

- Escape = Clear search text
- Escape again while empty = Leave search box

# Confirmation dialogs

削除・復元・サインアップ確認などの確認 dialog で有効です。

- Y = Confirm / proceed
- N = Cancel, or restore in Dust action dialog
- Escape = Cancel
`;

const firstTabId = crypto.randomUUID();

const state: AppState = {
  view: "editor",
  tabs: [
    {
      id: firstTabId,
      mode: "editor",
      text: DEFAULT_TEXT,
      dirty: false,
      currentMemoId: null,
      returnToTabId: null,
    }
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

const TAB_TITLE_MAX = 22;
const MAX_TABS = 8;
const FEEDBACK_MESSAGE_MAX_LENGTH = 4000;
const FEEDBACK_SELECTED_TEXT_MAX_LENGTH = 2000;

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
let switchRelativeTabHandler: ((delta: -1 | 1) => Promise<void>) | null = null;
let togglePreviewWideHandler: (() => Promise<void>) | null = null;
let toggleEditWideHandler: (() => Promise<void>) | null = null;

// let alignIndentShortcutHandler: (() => Promise<void>) | null = null;

let renderTabsHandler: (() => void) | null = null;

let openHeadingListPopupHandler: (() => Promise<void>) | null = null;
let openSearchHandler: (() => Promise<void>) | null = null;
let openFeedbackDialogHandler: (() => Promise<void>) | null = null;

// --- List focus / multi-select (Explorer & Dust) ---
let explorerSelectToggleHandler: (() => Promise<void>) | null = null;
let explorerMoveFocusHandler: ((delta: -1 | 1) => Promise<void>) | null = null;
let explorerOpenFocusHandler: (() => Promise<void>) | null = null;
let dustSelectToggleHandler: (() => Promise<void>) | null = null;
let dustMoveFocusHandler: ((delta: -1 | 1) => Promise<void>) | null = null;
let dustOpenFocusHandler: (() => Promise<void>) | null = null;

let teardownPanesResize: (() => void) | null = null;
let teardownFeedbackDialog: (() => void) | null = null;

type MemoViewportState = {
  selectionStart: number;
  selectionEnd: number;
  inputScrollTop: number;
  inputScrollLeft: number;
  previewScrollTop: number;
  hadInputFocus: boolean;
};

const memoViewportStateByTabId = new Map<string, MemoViewportState>();
let teardownMemoViewportHandlers: (() => void) | null = null;

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

function keyConfirmSignUp(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "key-confirm-overlay";

    const card = document.createElement("div");
    card.className = "key-confirm";

    const title = document.createElement("div");
    title.className = "key-confirm-title";
    title.textContent = "Account required";

    const body = document.createElement("div");
    body.className = "key-confirm-body";
    body.textContent = message;

    const hint = document.createElement("div");
    hint.className = "key-confirm-hint";
    hint.textContent = "Press Y to open Sign up / N to close";

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

function keyConfirmDustRestoreAndOpen(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "key-confirm-overlay";

    const card = document.createElement("div");
    card.className = "key-confirm";

    const title = document.createElement("div");
    title.className = "key-confirm-title";
    title.textContent = "Move from Dust";

    const body = document.createElement("div");
    body.className = "key-confirm-body";
    body.textContent = message;

    const hint = document.createElement("div");
    hint.className = "key-confirm-hint";
    hint.textContent = "Press Y to move to Explorer and open / N to cancel";

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

let msgTimer: number | undefined;
// let msgHoldUntil = 0;

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
  // msgHoldUntil = Date.now() + duration;

  if (msgTimer) window.clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => {
    // msgHoldUntil = 0;
    msgText.textContent = activeTab().dirty ? "Unsaved" : "";
  }, duration);
}

async function requireUserId(): Promise<string> {
  const session = await getSession();
  const userId = session?.user.id;
  if (!userId) throw new Error("not Logged in");
  return userId;
}

type SaveResult = "noop" | "created" | "updated" | "auth_required";

type AutoUpdateResult = "noop" | "updated";

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
  renderTabsHandler?.();
  trackEvent("memo_updated", { trigger: "auto_update" });
  trackEvent("memo_saved", { result: "updated", trigger: "auto_update" });
  return "updated";
}


async function saveIfDirty(
  trigger: "shortcut" | "auto_update" = "shortcut"
): Promise<SaveResult> {

  const tab = activeTab();
  if (!tab.dirty) return "noop";

  const session = await getSession();
  const userId = session?.user.id ?? null;

  if (!userId) {
    const goSignup = await keyConfirmSignUp(
      "未ログインのため保存できません。\n\nアカウントを作成しますか？"
    );

    if (goSignup) {
      openAccountScreen("signup");
    }
    trackEvent("memo_saved", { result: "auth_required", trigger });
    return "auth_required";
  }

  if (tab.currentMemoId) {
    await updateMemo({userId, id: tab.currentMemoId, content: tab.text});
    tab.dirty = false;
    renderTabsHandler?.();
    trackEvent("memo_updated", { trigger });
    trackEvent("memo_saved", { result: "updated", trigger });
    return "updated";
  } else {

    const created = await createMemo({userId, content: tab.text});
    tab.currentMemoId = created.id;
    tab.dirty = false;
    renderTabsHandler?.();
    trackEvent("memo_created", { trigger });
    trackEvent("memo_saved", { result: "created", trigger });
    return "created";
  }
}

function registerSaveShortcut() {
  if (saveShortcutRegistered) return;
  saveShortcutRegistered = true;

  const handler = async (e: KeyboardEvent) => {
    if (!(e instanceof KeyboardEvent)) return;
    if (e.isComposing) return;

    const isPotentialAppShortcut = e.altKey && e.shiftKey && (e.ctrlKey || e.metaKey);
    if (isPotentialAppShortcut) {
      const target = e.target instanceof HTMLElement
        ? `${e.target.tagName.toLowerCase()}${e.target.id ? `#${e.target.id}` : ""}${e.target.className ? `.${String(e.target.className).replace(/\s+/g, ".")}` : ""}`
        : String(e.target ?? "");

      console.info("[shortcut] keydown", {
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        view: state.view,
        activeTabMode: activeTab().mode,
        openSearchHandlerReady: !!openSearchHandler,
        target,
      });
    }

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

    const relativeTabDelta = getRelativeTabShortcutDelta(e);

    if (relativeTabDelta !== null) {
      e.preventDefault();
      if (switchRelativeTabHandler) void switchRelativeTabHandler(relativeTabDelta);
      return;
    }

    if (isTogglePreviewWideShortcut(e)) {
      e.preventDefault();
      if (togglePreviewWideHandler) void togglePreviewWideHandler();
      return;
    }
    
    if (isToggleEditWideShortcut(e)) {
      e.preventDefault();
      if (toggleEditWideHandler) void toggleEditWideHandler();
      return;
    }
    
    if (isSearchShortcut(e)) {
      e.preventDefault();
      console.info("[shortcut] search matched", {
        openSearchHandlerReady: !!openSearchHandler,
        view: state.view,
        activeTabMode: activeTab().mode,
      });

      if (!openSearchHandler) {
        console.error("[shortcut] search matched, but openSearchHandler is null. mountMemoUI() may not have assigned it.");
        return;
      }

      void openSearchHandler().catch((err) => {
        console.error("[shortcut] openSearchHandler failed", err);
      });
      return;
    }

    if (isHeadingPopupShortcut(e)) {
      e.preventDefault();
      if (openHeadingListPopupHandler) void openHeadingListPopupHandler();
      return;
    }

    if (isAccountSettingsShortcut(e)) {
      e.preventDefault();

      if (getAppScreen() === "accountSettings") {
        openMemoScreen();
        return;
      }

      const session = await getSession();
      if (session) {
        openAccountSettingsScreen();
      } else {
        openAccountScreen("signin");
      }
      return;
    }

    if (isFeedbackShortcut(e)) {
      e.preventDefault();

      const session = await getSession();
      if (!session) {
        openAccountScreen("signin", "Sign in to send feedback.", "info");
        return;
      }

      if (openFeedbackDialogHandler) {
        void openFeedbackDialogHandler();
      }
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
      const result = await saveIfDirty("shortcut");

      if (result === "updated") showMessage("Updated ✨");
      else if (result === "created") showMessage("Created a new memo 🚀");
      else if (result === "auth_required") showMessage(t("msgSaveRequiresAccount"), 4500);
      else showMessage("Nothing to save - you're all set.");
    } catch (err) {
      console.error("save failed", err);
      showMessage("Oops - save failed 😵‍💫", 2500);
      // setDirty(true);
    }
  };

  window.addEventListener("keydown", handler, { passive: false });
}

export function mountMemoUI(app: HTMLDivElement, deps: MountMemoUIDeps) {
  const { rerender } = deps;

  setAppScreen("memo");
  app.innerHTML = memoUIHtml;

  // ---- elements
  const logoutBtn = qs<HTMLButtonElement>("#logoutBtn");
  const displayNameText = qs<HTMLSpanElement>("#displayNameText");
  const accountSettingsBtn = qs<HTMLButtonElement>("#accountSettingsBtn");
  const signinBtn = qs<HTMLButtonElement>("#signinBtn");
  const signupBtn = qs<HTMLButtonElement>("#signupBtn");

  signupBtn.textContent = t("createAccount");
  accountSettingsBtn.textContent = t("accountSettings");

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

  const refreshHeaderAuthUi = async () => {
    const session = await getSession();
    const loggedIn = !!session;
  
    let displayName = "";
    if (session?.user?.id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", session.user.id)
        .maybeSingle();
  
      const user = await getUser().catch(() => null);
      displayName = (
        profile?.display_name ||
        String(user?.user_metadata?.display_name ?? "").trim() ||
        String(user?.user_metadata?.given_name ?? "").trim() ||
        session.user.email?.split("@")[0] ||
        "User"
      );
    }
  
    displayNameText.hidden = !loggedIn;
    displayNameText.textContent = loggedIn ? displayName : "";
  
    accountSettingsBtn.hidden = !loggedIn;
    logoutBtn.hidden = !loggedIn;
    signinBtn.hidden = loggedIn;
    signupBtn.hidden = loggedIn;
  
    accountSettingsBtn.disabled = !loggedIn;
    logoutBtn.disabled = !loggedIn;
    signinBtn.disabled = loggedIn;
    signupBtn.disabled = loggedIn;
  };

  // --- pseudo tags (Input) ---
  const pseudoTagBar = qs<HTMLElement>("#presudoTagBar, #pseudoTagBar");
  const pseudoTagList = qs<HTMLDivElement>("#pseudoTagList");

  const tagSuggest = qs<HTMLDivElement>("#tagSuggest");

  const searchBar = qs<HTMLElement>("#searchBar");
  const searchInput = qs<HTMLInputElement>("#searchInput");
  const searchClearBtn = qs<HTMLButtonElement>("#searchClearBtn");

  const panes = qs<HTMLDivElement>("#editorView .panes");

  // 既存の resize 監視があれば解除（rerender対策）
  teardownPanesResize?.();
  teardownPanesResize = null;

  const syncPanesHeight = () => {
    const top = panes.getBoundingClientRect().top;
    const h = Math.max(240, window.innerHeight - top); // 下限は好みで
    panes.style.height = `${h}px`;
    panes.style.flex = "0 0 auto"; // height を優先させる
  };

  // 初回
  syncPanesHeight();

  // リサイズ時
  window.addEventListener("resize", syncPanesHeight);
  teardownPanesResize = () => {
    window.removeEventListener("resize", syncPanesHeight);
  };

  const inputPane = input.closest<HTMLElement>(".pane");
  if (!inputPane) throw new Error("input pane not found");

  const previewPane = preview.closest<HTMLElement>(".pane");
  if (!previewPane) throw new Error("preview pane not found");

  let isPreviewWide = false;
  let isEditWide = false;
  let memoInputHadFocus = false;

  const clampSelectionPosition = (value: string, position: number) =>
    Math.max(0, Math.min(value.length, position));

  const PREVIEW_CARET_ANCHOR_LINE = 4;

  const saveActiveMemoViewport = () => {
    if (state.view !== "editor") return;

    const tab = activeTab();
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? selectionStart;

    memoViewportStateByTabId.set(tab.id, {
      selectionStart,
      selectionEnd,
      inputScrollTop: input.scrollTop,
      inputScrollLeft: input.scrollLeft,
      previewScrollTop: preview.scrollTop,
      hadInputFocus: memoInputHadFocus,
    });
  };

  const restoreActiveMemoViewport = (forceFocus = false) => {
    if (state.view !== "editor") return;
    if (isPreviewWide) return;

    const tab = activeTab();
    const saved = memoViewportStateByTabId.get(tab.id);

    if (!saved) {
      if (forceFocus) input.focus({ preventScroll: true });
      return;
    }

    const applyRestore = () => {
      const start = clampSelectionPosition(input.value, saved.selectionStart);
      const end = clampSelectionPosition(input.value, saved.selectionEnd);
      const shouldFocus = forceFocus || saved.hadInputFocus;

      if (shouldFocus) {
        input.focus({ preventScroll: true });
      }

      input.setSelectionRange(start, end);
      input.scrollTop = saved.inputScrollTop;
      input.scrollLeft = saved.inputScrollLeft;

      const maxPreviewScroll = Math.max(0, preview.scrollHeight - preview.clientHeight);
      preview.scrollTop = Math.max(
        0,
        Math.min(saved.previewScrollTop, maxPreviewScroll)
      );
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        applyRestore();
      });
    });
  };

  const applyEditorPaneMode = () => {
    const isSinglePane = isPreviewWide || isEditWide;
  
    inputPane.hidden = isPreviewWide;
    previewPane.hidden = isEditWide;
    panes.classList.toggle("is-preview-wide", isPreviewWide);
    panes.classList.toggle("is-edit-wide", isEditWide);
    panes.style.gridTemplateColumns = isSinglePane ? "1fr" : "";
  
    if (isPreviewWide) {
      preview.tabIndex = 0;
      if (document.activeElement === input) input.blur();
      return;
    }
  
    restoreActiveMemoViewport(true);
  };
  
  const applyPreviewWide = (on: boolean) => {
    if (on) saveActiveMemoViewport();
  
    isPreviewWide = on;
    if (on) isEditWide = false;
  
    applyEditorPaneMode();
  };
  
  const applyEditWide = (on: boolean) => {
    if (on) saveActiveMemoViewport();
  
    isEditWide = on;
    if (on) isPreviewWide = false;
  
    applyEditorPaneMode();
  };

  const focusEditorInputIfVisible = () => {
    if (state.view !== "editor") return;
    if (isPreviewWide) return;
    restoreActiveMemoViewport(true);
  };

  const focusMemoStart = () => {
    if (isPreviewWide) return;
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(0, 0);
      input.scrollTop = 0;
      input.scrollLeft = 0;
      preview.scrollTop = 0;
      saveActiveMemoViewport();
    });
  };

  const findOpenMemoTab = (memoId: string): TabState | null => {
    return state.tabs.find(
      (t) => t.mode === "editor" && t.currentMemoId === memoId
    ) ?? null;
  };

  const activateMemoTabIfAlreadyOpen = async (
    memoId: string,
    message?: string
  ): Promise<boolean> => {
    const existing = findOpenMemoTab(memoId);
    if (!existing) return false;

    await activateTab(existing.id);
    showMessage(message ?? `Already open → ${memoTitleFromContent(existing.text)}`);
    return true;
  };
  
  type PreviewLineAnchor = {
    element: HTMLElement;
    lineOffsetPx: number;
  };

  const getPreviewLineHeight = (element: HTMLElement) => {
    return (
      Number.parseFloat(window.getComputedStyle(element).lineHeight) ||
      Number.parseFloat(window.getComputedStyle(input).lineHeight) ||
      22
    );
  };

  const findPreviewLineAnchor = (lineNo: number): PreviewLineAnchor | null => {
    const exact = preview.querySelector<HTMLElement>(`[data-source-line="${lineNo}"]`);
    if (exact) return { element: exact, lineOffsetPx: 0 };

    const ranged = Array.from(
      preview.querySelectorAll<HTMLElement>("[data-source-line-start][data-source-line-end]")
    );

    for (const element of ranged) {
      const start = Number.parseInt(element.dataset.sourceLineStart ?? "", 10);
      const end = Number.parseInt(element.dataset.sourceLineEnd ?? "", 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (lineNo < start || lineNo > end) continue;

      return {
        element,
        lineOffsetPx: Math.max(0, lineNo - start) * getPreviewLineHeight(element),
      };
    }

    return null;
  };

  const scrollPreviewToTextPositionByRatio = (position: number) => {
    const text = input.value;
    const maxScroll = Math.max(0, preview.scrollHeight - preview.clientHeight);
    if (maxScroll <= 0) return;

    const pos = clampSelectionPosition(text, position);
    const before = text.slice(0, pos);
    const beforeLines = before.split(/\r?\n/).length - 1;
    const totalLines = text.split(/\r?\n/).length - 1;

    let ratio = 0;
    if (totalLines > 0) {
      ratio = beforeLines / totalLines;
    } else if (text.length > 0) {
      ratio = pos / text.length;
    }

    preview.scrollTop = Math.max(0, Math.min(maxScroll, maxScroll * ratio));
  };

  const scrollPreviewToTextPosition = (position: number) => {
    const text = input.value;
    const maxScroll = Math.max(0, preview.scrollHeight - preview.clientHeight);
    if (maxScroll <= 0) return;

    const pos = clampSelectionPosition(text, position);
    const lineStart = getLineStartIndex(text, pos);
    const lineNo = text.slice(0, lineStart).split(/\r?\n/).length - 1;
    const anchor = findPreviewLineAnchor(lineNo);

    if (!anchor) {
      scrollPreviewToTextPositionByRatio(pos);
      return;
    }

    const previewRect = preview.getBoundingClientRect();
    const anchorRect = anchor.element.getBoundingClientRect();
    const fixedLineOffset =
      getPreviewLineHeight(anchor.element) * Math.max(0, PREVIEW_CARET_ANCHOR_LINE - 1);
    const targetTop =
      preview.scrollTop + anchorRect.top - previewRect.top + anchor.lineOffsetPx - fixedLineOffset;

    preview.scrollTop = Math.max(0, Math.min(maxScroll, targetTop));
  };

  const syncPreviewToCaret = () => {
    scrollPreviewToTextPosition(input.selectionStart ?? 0);
  };

  const scrollInputToTextPosition = (position: number) => {
    const value = input.value;
    const pos = clampSelectionPosition(value, position);
    const lineStart = getLineStartIndex(value, pos);
    const lineNo = value.slice(0, lineStart).split(/\r?\n/).length - 1;
    const lineHeight = Number.parseFloat(window.getComputedStyle(input).lineHeight) || 22;

    input.scrollTop = Math.max(
      0,
      lineNo * lineHeight - input.clientHeight / 2 + lineHeight * 2
    );
    input.scrollLeft = 0;
  };
  
  type MemoHeadingEntry = {
    level: number;
    title: string;
    position: number;
  };

  let teardownHeadingPopup: (() => void) | null = null;

  const extractMemoHeadings = (text: string): MemoHeadingEntry[] => {
    const entries: MemoHeadingEntry[] = [];
    const re = /^(#{1,6})\s+(.+)$/gm;

    for (const m of text.matchAll(re)) {
      const hashes = m[1] ?? "";
      const rawTitle = m[2] ?? "";
      const title = rawTitle.trim();
      if (!title) continue;

      entries.push({
        level: hashes.length,
        title,
        position: m.index ?? 0,
      });
    }

    return entries;
  };

  const moveCaretToHeading = (entry: MemoHeadingEntry) => {
    const value = input.value;
    const pos = Math.max(0, Math.min(value.length, entry.position));

    input.focus();
    input.setSelectionRange(pos, pos);

    const lineStart = getLineStartIndex(value, pos);
    const lineNo = value.slice(0, lineStart).split(/\r?\n/).length - 1;
    const lineHeight = Number.parseFloat(window.getComputedStyle(input).lineHeight) || 22;
    const targetTop = Math.max(
      0,
      lineNo * lineHeight - input.clientHeight / 2 + lineHeight * 2
    );

    input.scrollTop = targetTop;
    input.scrollLeft = 0;

    syncPreviewToCaret();
    saveActiveMemoViewport();
  };

  const closeHeadingPopup = (restoreEditorFocus = true) => {
    if (!teardownHeadingPopup) return;
    const teardown = teardownHeadingPopup;
    teardownHeadingPopup = null;
    teardown();

    if (restoreEditorFocus) {
      focusEditorInputIfVisible();
    }
  };

  const openHeadingPopup = async () => {
    if (state.view !== "editor" || activeTab().mode !== "editor") {
      showMessage("Heading list popup is available only when a memo is open.");
      return;
    }

    const headings = extractMemoHeadings(input.value);
    if (headings.length === 0) {
      showMessage("No headings found in this memo.");
      return;
    }

    closeHeadingPopup(false);

    const overlay = document.createElement("div");
    overlay.className = "heading-popup-overlay";

    const panel = document.createElement("div");
    panel.className = "heading-popup";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Heading list popup");

    const title = document.createElement("div");
    title.className = "heading-popup-title";
    title.textContent = "Headings";

    const hint = document.createElement("div");
    hint.className = "heading-popup-hint";
    hint.textContent = "↑ ↓ to move · Enter to jump · Esc to close";

    const list = document.createElement("div");
    list.className = "heading-popup-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Headings");

    panel.append(title, hint, list);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let focusIndex = 0;

    const renderHeadingPopup = () => {
      list.innerHTML = headings
        .map((h, idx) => {
          const active = idx === focusIndex;
          const indent = "&nbsp;".repeat((h.level - 1) * 4);
          const label = `${"#".repeat(h.level)} ${escapeHtml(h.title)}`;

          return `
            <button
              type="button"
              class="heading-popup-item ${active ? "is-active" : ""}"
              role="option"
              aria-selected="${active ? "true" : "false"}"
              data-idx="${idx}"
            >
              <span class="heading-popup-item-level">${indent}</span>
              <span class="heading-popup-item-text">${label}</span>
            </button>
          `;
        })
        .join("");

      const activeEl = list.querySelector<HTMLButtonElement>("button[data-idx].is-active");
      activeEl?.scrollIntoView({ block: "nearest" });
    };

    const jumpToFocusedHeading = () => {
      const entry = headings[focusIndex];
      if (!entry) return;
      closeHeadingPopup(false);
      moveCaretToHeading(entry);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeHeadingPopup(true);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        focusIndex = Math.min(headings.length - 1, focusIndex + 1);
        renderHeadingPopup();
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        focusIndex = Math.max(0, focusIndex - 1);
        renderHeadingPopup();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        jumpToFocusedHeading();
      }
    };

    const onOverlayClick = (e: MouseEvent) => {
      if (e.target !== overlay) return;
      closeHeadingPopup(true);
    };

    const onListClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest<HTMLButtonElement>("button[data-idx]");
      const idxStr = btn?.dataset.idx;
      if (idxStr == null) return;

      const idx = Number(idxStr);
      if (!Number.isFinite(idx)) return;

      focusIndex = Math.max(0, Math.min(headings.length - 1, idx));
      renderHeadingPopup();
      jumpToFocusedHeading();
    };

    overlay.addEventListener("click", onOverlayClick);
    list.addEventListener("click", onListClick);
    window.addEventListener("keydown", onKeyDown, true);

    teardownHeadingPopup = () => {
      window.removeEventListener("keydown", onKeyDown, true);
      overlay.removeEventListener("click", onOverlayClick);
      list.removeEventListener("click", onListClick);
      overlay.remove();
    };

    renderHeadingPopup();
  };


  type MemoSearchEntry = {
    position: number;
    endPosition: number;
    lineNo: number;
    label: string;
  };

  const normalizeMemoSearchText = (value: string) => value.toLocaleLowerCase();

  const ellipsizeSearchLine = (line: string, maxLen = 140) => {
    const normalized = line.replaceAll("\t", "    ").trim();
    if (normalized.length <= maxLen) return normalized || "(blank line)";
    return `${normalized.slice(0, maxLen - 1)}…`;
  };

  const extractMemoSearchResults = (text: string, query: string): MemoSearchEntry[] => {
    const needleRaw = query.trim();
    if (!needleRaw) return [];

    const hay = normalizeMemoSearchText(text);
    const needle = normalizeMemoSearchText(needleRaw);
    const entries: MemoSearchEntry[] = [];

    let pos = 0;
    while (pos <= hay.length) {
      const found = hay.indexOf(needle, pos);
      if (found === -1) break;

      const lineStart = text.lastIndexOf("\n", Math.max(0, found - 1)) + 1;
      const lineEndRaw = text.indexOf("\n", found);
      const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
      const lineNo = text.slice(0, lineStart).split(/\r?\n/).length;
      const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");

      entries.push({
        position: found,
        endPosition: found + needleRaw.length,
        lineNo,
        label: ellipsizeSearchLine(line),
      });

      if (entries.length >= 100) break;
      pos = found + Math.max(needle.length, 1);
    }

    return entries;
  };

  const jumpToMemoSearchEntry = (entry: MemoSearchEntry) => {
    const start = clampSelectionPosition(input.value, entry.position);
    const end = clampSelectionPosition(input.value, entry.endPosition);

    if (isPreviewWide) {
      scrollPreviewToTextPosition(start);
      saveActiveMemoViewport();
      return;
    }

    input.focus({ preventScroll: true });
    input.setSelectionRange(start, end);
    scrollInputToTextPosition(start);
    scrollPreviewToTextPosition(start);
    saveActiveMemoViewport();
  };

  const getInitialMemoSearchQuery = () => {
    if (isPreviewWide) return "";

    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    if (end <= start) return "";

    const selected = input.value.slice(start, end).trim();
    if (!selected || /\r?\n/.test(selected)) return "";
    return selected.length > 80 ? selected.slice(0, 80) : selected;
  };

  const openMemoSearchPopup = async () => {
    if (state.view !== "editor" || activeTab().mode !== "editor") {
      showMessage("Memo search is available only when a memo is open.");
      return;
    }

    closeHeadingPopup(false);

    const overlay = document.createElement("div");
    overlay.className = "heading-popup-overlay";

    const panel = document.createElement("div");
    panel.className = "heading-popup";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", isPreviewWide ? "Preview search" : "Memo search");

    const title = document.createElement("div");
    title.className = "heading-popup-title";
    title.textContent = isPreviewWide ? "Search Preview" : "Search Memo";

    const searchBox = document.createElement("input");
    searchBox.className = "heading-popup-search";
    searchBox.type = "search";
    searchBox.autocomplete = "off";
    searchBox.spellcheck = false;
    searchBox.placeholder = isPreviewWide ? "Search in preview..." : "Search in memo...";
    searchBox.value = getInitialMemoSearchQuery();

    const hint = document.createElement("div");
    hint.className = "heading-popup-hint";
    hint.textContent = "Type to search · ↑ ↓ to move · Enter to jump · Esc to close";

    const list = document.createElement("div");
    list.className = "heading-popup-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Search results");

    panel.append(title, searchBox, hint, list);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let focusIndex = 0;
    let results = extractMemoSearchResults(input.value, searchBox.value);

    const renderSearchPopup = () => {
      const q = searchBox.value.trim();
      results = extractMemoSearchResults(input.value, q);
      focusIndex = Math.max(0, Math.min(focusIndex, results.length - 1));

      if (!q) {
        list.innerHTML = `<div class="heading-popup-empty">検索語を入力してください。</div>`;
        return;
      }

      if (results.length === 0) {
        list.innerHTML = `<div class="heading-popup-empty">No matches for "${escapeHtml(q)}"</div>`;
        return;
      }

      list.innerHTML = results
        .map((r, idx) => {
          const active = idx === focusIndex;
          return `
            <button
              type="button"
              class="heading-popup-item ${active ? "is-active" : ""}"
              role="option"
              aria-selected="${active ? "true" : "false"}"
              data-idx="${idx}"
            >
              <span class="heading-popup-item-level">L${r.lineNo}</span>
              <span class="heading-popup-item-text">${escapeHtml(r.label)}</span>
            </button>
          `;
        })
        .join("");

      const activeEl = list.querySelector<HTMLButtonElement>("button[data-idx].is-active");
      activeEl?.scrollIntoView({ block: "nearest" });
    };

    const closeSearchPopup = (restoreFocus = true) => {
      window.removeEventListener("keydown", onKeyDown, true);
      overlay.removeEventListener("click", onOverlayClick);
      list.removeEventListener("click", onListClick);
      searchBox.removeEventListener("input", onSearchInput);
      overlay.remove();

      if (!restoreFocus) return;
      if (isPreviewWide) preview.focus({ preventScroll: true });
      else focusEditorInputIfVisible();
    };

    const jumpToFocusedSearchResult = () => {
      const entry = results[focusIndex];
      if (!entry) return;
      closeSearchPopup(false);
      jumpToMemoSearchEntry(entry);
      showMessage(`Search hit ${focusIndex + 1}/${results.length}`);
    };

    function onSearchInput() {
      focusIndex = 0;
      renderSearchPopup();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeSearchPopup(true);
        return;
      }

      if (e.key === "ArrowDown") {
        if (results.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        focusIndex = Math.min(results.length - 1, focusIndex + 1);
        renderSearchPopup();
        return;
      }

      if (e.key === "ArrowUp") {
        if (results.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        focusIndex = Math.max(0, focusIndex - 1);
        renderSearchPopup();
        return;
      }

      if (e.key === "Enter") {
        if (results.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        jumpToFocusedSearchResult();
      }
    }

    function onOverlayClick(e: MouseEvent) {
      if (e.target !== overlay) return;
      closeSearchPopup(true);
    }

    function onListClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest<HTMLButtonElement>("button[data-idx]");
      const idxStr = btn?.dataset.idx;
      if (idxStr == null) return;

      const idx = Number(idxStr);
      if (!Number.isFinite(idx)) return;

      focusIndex = Math.max(0, Math.min(results.length - 1, idx));
      jumpToFocusedSearchResult();
    }

    searchBox.addEventListener("input", onSearchInput);
    overlay.addEventListener("click", onOverlayClick);
    list.addEventListener("click", onListClick);
    window.addEventListener("keydown", onKeyDown, true);

    renderSearchPopup();
    window.requestAnimationFrame(() => {
      searchBox.focus();
      searchBox.select();
    });
  };

  const closeFeedbackDialog = (restoreFocus = true) => {
    if (!teardownFeedbackDialog) return;
    const teardown = teardownFeedbackDialog;
    teardownFeedbackDialog = null;
    teardown();

    if (restoreFocus) {
      focusEditorInputIfVisible();
    }
  };

  const getSelectedMemoTextForFeedback = () => {
    if (state.view !== "editor" || activeTab().mode !== "editor") return "";

    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    if (end <= start) return "";

    return input.value.slice(start, end);
  };

  const getFeedbackEnvironment = () => {
    const tab = activeTab();

    return {
      appScreen: getAppScreen(),
      view: state.view,
      activeTabMode: tab.mode,
      hasSavedMemo: String(Boolean(tab.currentMemoId)),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      screen: `${window.screen.width}x${window.screen.height}`,
      language: navigator.language,
      languages: navigator.languages.join(", "),
      platform: navigator.platform,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
      url: `${window.location.origin}${window.location.pathname}`,
      userAgent: navigator.userAgent,
    };
  };

  const stringifyFeedbackEnvironment = (environment: Record<string, string>) =>
    Object.entries(environment)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");

  const formatFeedbackError = (error: unknown) => {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    const raw = String(error ?? "").trim();
    return raw || "Could not send feedback. Please try again later.";
  };

  const openFeedbackDialog = async () => {
    const session = await getSession();
    if (!session) {
      openAccountScreen("signin", "Sign in to send feedback.", "info");
      return;
    }

    closeHeadingPopup(false);
    closeFeedbackDialog(false);

    const selectedText = getSelectedMemoTextForFeedback();
    const environment = getFeedbackEnvironment();
    const environmentText = stringifyFeedbackEnvironment(environment);

    const overlay = document.createElement("div");
    overlay.className = "feedback-dialog-overlay";

    const form = document.createElement("form");
    form.className = "feedback-dialog";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.setAttribute("aria-labelledby", "feedbackDialogTitle");

    const title = document.createElement("div");
    title.id = "feedbackDialogTitle";
    title.className = "feedback-dialog-title";
    title.textContent = "Feedback";

    const msg = document.createElement("div");
    msg.className = "feedback-dialog-msg";
    msg.hidden = true;

    const feedbackLabel = document.createElement("label");
    feedbackLabel.className = "feedback-dialog-label";
    feedbackLabel.htmlFor = "feedbackMessageInput";
    feedbackLabel.textContent = "Message";

    const feedbackInput = document.createElement("textarea");
    feedbackInput.id = "feedbackMessageInput";
    feedbackInput.className = "feedback-dialog-input";
    feedbackInput.maxLength = FEEDBACK_MESSAGE_MAX_LENGTH;
    feedbackInput.required = true;
    feedbackInput.spellcheck = true;

    const feedbackCounter = document.createElement("div");
    feedbackCounter.className = "feedback-dialog-counter";

    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.className = "feedback-dialog-details-button";
    detailsButton.setAttribute("aria-expanded", "false");
    detailsButton.textContent = "Details";

    const details = document.createElement("div");
    details.className = "feedback-dialog-details";
    details.hidden = true;

    const selectionId = "feedbackIncludeSelection";
    const selectionCheck = document.createElement("input");
    selectionCheck.id = selectionId;
    selectionCheck.type = "checkbox";
    selectionCheck.disabled = selectedText.trim().length === 0;

    const selectionLabel = document.createElement("label");
    selectionLabel.className = "feedback-dialog-check";
    selectionLabel.htmlFor = selectionId;
    selectionLabel.append(selectionCheck, document.createTextNode("Include selected text"));

    const selectionInput = document.createElement("textarea");
    selectionInput.className = "feedback-dialog-context-input";
    selectionInput.maxLength = FEEDBACK_SELECTED_TEXT_MAX_LENGTH;
    selectionInput.value = selectedText.slice(0, FEEDBACK_SELECTED_TEXT_MAX_LENGTH);
    selectionInput.disabled = true;
    selectionInput.spellcheck = false;
    selectionInput.placeholder = selectedText.trim() ? "" : "No selected text";

    const selectionCounter = document.createElement("div");
    selectionCounter.className = "feedback-dialog-counter";

    const environmentId = "feedbackIncludeEnvironment";
    const environmentCheck = document.createElement("input");
    environmentCheck.id = environmentId;
    environmentCheck.type = "checkbox";

    const environmentLabel = document.createElement("label");
    environmentLabel.className = "feedback-dialog-check";
    environmentLabel.htmlFor = environmentId;
    environmentLabel.append(environmentCheck, document.createTextNode("Include environment"));

    const environmentInput = document.createElement("textarea");
    environmentInput.className = "feedback-dialog-context-input";
    environmentInput.value = environmentText;
    environmentInput.disabled = true;
    environmentInput.readOnly = true;
    environmentInput.spellcheck = false;

    details.append(
      selectionLabel,
      selectionInput,
      selectionCounter,
      environmentLabel,
      environmentInput
    );

    const actions = document.createElement("div");
    actions.className = "feedback-dialog-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "feedback-dialog-button feedback-dialog-button-secondary";
    cancelButton.textContent = "Cancel";

    const submitButton = document.createElement("button");
    submitButton.type = "submit";
    submitButton.className = "feedback-dialog-button feedback-dialog-button-primary";
    submitButton.textContent = "Send";

    actions.append(cancelButton, submitButton);
    form.append(
      title,
      msg,
      feedbackLabel,
      feedbackInput,
      feedbackCounter,
      detailsButton,
      details,
      actions
    );
    overlay.append(form);
    document.body.append(overlay);

    let busy = false;

    const setMsg = (text: string, kind: "info" | "error" = "error") => {
      if (!text) {
        msg.hidden = true;
        msg.textContent = "";
        return;
      }

      msg.hidden = false;
      msg.textContent = text;
      msg.dataset.kind = kind;
    };

    const setBusy = (value: boolean) => {
      busy = value;
      feedbackInput.disabled = value;
      detailsButton.disabled = value;
      selectionCheck.disabled = value || selectedText.trim().length === 0;
      selectionInput.disabled = value || !selectionCheck.checked;
      environmentCheck.disabled = value;
      environmentInput.disabled = value || !environmentCheck.checked;
      cancelButton.disabled = value;
      submitButton.disabled = value;
      submitButton.textContent = value ? "Sending..." : "Send";
    };

    const updateCounters = () => {
      feedbackCounter.textContent = `${feedbackInput.value.length}/${FEEDBACK_MESSAGE_MAX_LENGTH}`;
      selectionCounter.textContent = `${selectionInput.value.length}/${FEEDBACK_SELECTED_TEXT_MAX_LENGTH}`;
    };

    const syncOptionalInputs = () => {
      selectionInput.disabled = busy || !selectionCheck.checked;
      environmentInput.disabled = busy || !environmentCheck.checked;
    };

    detailsButton.addEventListener("click", () => {
      const nextOpen = details.hidden;
      details.hidden = !nextOpen;
      detailsButton.setAttribute("aria-expanded", String(nextOpen));
    });

    feedbackInput.addEventListener("input", () => {
      setMsg("");
      updateCounters();
    });

    selectionInput.addEventListener("input", updateCounters);
    selectionCheck.addEventListener("change", syncOptionalInputs);
    environmentCheck.addEventListener("change", syncOptionalInputs);

    cancelButton.addEventListener("click", () => {
      if (busy) return;
      closeFeedbackDialog(true);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;

      const message = feedbackInput.value.trim();
      const optionalSelection = selectionCheck.checked
        ? selectionInput.value.trim()
        : "";

      if (!message) {
        setMsg("Enter feedback before sending.", "error");
        feedbackInput.focus();
        return;
      }

      try {
        setBusy(true);
        setMsg("Sending feedback...", "info");

        await submitFeedback({
          message,
          selectedText: optionalSelection || undefined,
          environment: environmentCheck.checked ? environment : undefined,
        });

        trackEvent("feedback_sent", {
          included_selection: !!optionalSelection,
          included_environment: environmentCheck.checked,
        });
        closeFeedbackDialog(true);
        showMessage("Feedback sent. Thank you.");
      } catch (error) {
        console.error("feedback failed", error);
        setMsg(formatFeedbackError(error), "error");
      } finally {
        if (document.body.contains(overlay)) {
          setBusy(false);
        }
      }
    });

    function onOverlayClick(event: MouseEvent) {
      if (event.target !== overlay || busy) return;
      closeFeedbackDialog(true);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) closeFeedbackDialog(true);
        return;
      }

      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        form.requestSubmit();
      }
    }

    overlay.addEventListener("click", onOverlayClick);
    window.addEventListener("keydown", onKeyDown, true);

    teardownFeedbackDialog = () => {
      window.removeEventListener("keydown", onKeyDown, true);
      overlay.removeEventListener("click", onOverlayClick);
      overlay.remove();
    };

    updateCounters();
    syncOptionalInputs();

    window.requestAnimationFrame(() => {
      feedbackInput.focus();
    });
  };

  const openMemoFromExplorer = async (id: string) => {
    if (await activateMemoTabIfAlreadyOpen(id)) return;

    const tab = activeTab();
    if (tab.mode !== "explorer") return;

    const userId = await requireUserId();
    const memo = await getMemo({ userId, id });
    if (!memo) return;

    tab.mode = "editor";
    tab.currentMemoId = memo.id;
    tab.text = memo.content;
    tab.dirty = false;
    tab.returnToTabId = null;

    await activateTab(tab.id, { skipSaveViewport: true });
    showMessage(`Opened → ${memoTitleFromContent(memo.content)}`);
    focusMemoStart();
  };

  const openMemoInNewEditorTab = async (memo: MemoRow): Promise<boolean> => {
    if (await activateMemoTabIfAlreadyOpen(memo.id)) return true;

    if (state.tabs.length >= MAX_TABS) {
      showMessage(`Max ${MAX_TABS} tabs — close one before opening from Dust.`);
      return false;
    }

    const id = crypto.randomUUID();
    state.tabs.push({
      id,
      mode: "editor",
      text: memo.content,
      dirty: false,
      currentMemoId: memo.id,
      returnToTabId: null,
    });

    memoViewportStateByTabId.delete(id);
    await activateTab(id, { skipSaveViewport: true });
    showMessage(`Moved to Explorer and opened → ${memoTitleFromContent(memo.content)}`);
    focusMemoStart();
    return true;
  };

  // 初期反映
  applyEditorPaneMode();

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
  
  let savedMemoTagSource: MemoContentRow[] = [];
  let savedMemoTagSourceLoaded = false;
  let savedMemoTagSourceLoading: Promise<void> | null = null;
  let savedMemoTagSourceUserId: string | null = null;
  
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
  // --- tab UX helpers (shortcut switching etc.)
  const getTabLabel = (t: TabState) => {
    if (t.mode === "explorer") return "EXPLORER";
    if (t.mode === "dust") return "DUST";
    return memoTitleFromContent(t.text);
  };
  
  const findOpenSpecialTab = (mode: "explorer" | "dust"): TabState | null => {
    return state.tabs.find((t) => t.mode === mode) ?? null;
  };

  const activateSpecialTabIfAlreadyOpen = async (
    mode: "explorer" | "dust"
  ): Promise<boolean> => {
    const existing = findOpenSpecialTab(mode);
    if (!existing) return false;

    await activateTab(existing.id);
    return true;
  };

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
  
  const createSpecialTab = async (
    mode: "explorer" | "dust",
    returnToTabId: string | null
  ) => {
    if (state.tabs.length >= MAX_TABS) {
      showMessage(`Max ${MAX_TABS} tabs — close one to add.`);
      return false;
    }
  
    const id = crypto.randomUUID();
    state.tabs.push({
      id,
      mode,
      text: "",
      dirty: false,
      currentMemoId: null,
      returnToTabId,
    });
  
    await activateTab(id);
    return true;
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
      scrollTabIntoView(target.id);
      showMessage(`Already on Tab ${digit}: ${getTabLabel(target)}`);
      return;
    }
  
    let saveResult: SaveResult = "noop";
    try {
      saveResult = await saveIfDirty("auto_update"); // 未保存なら保存してから切替
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
  
  switchRelativeTabHandler = async (delta: -1 | 1) => {
    if (state.tabs.length <= 1) {
      const tab = activeTab();
      scrollTabIntoView(tab.id);
      showMessage(`Already on the only tab: ${getTabLabel(tab)}`);
      return;
    }

    const currentIndex = state.tabs.findIndex((t) => t.id === state.activeTabId);

    if (currentIndex < 0) {
      showMessage("Active tab not found.");
      return;
    }

    const nextIndex = (currentIndex + delta + state.tabs.length) % state.tabs.length;
    const target = state.tabs[nextIndex];

    if (!target) {
      showMessage("Target tab not found.");
      return;
    }

    let saveResult: SaveResult = "noop";
    try {
      saveResult = await saveIfDirty("auto_update"); // 未保存なら保存してから切替
    } catch (err) {
      console.error("save failed before switching relative tab", err);
      showMessage("Oops — save failed 😵‍💫", 2500);
      return; // 保存失敗 → 切替しない
    }

    await activateTab(target.id);

    const tabNumber = nextIndex + 1;
    const title = getTabLabel(target);
    const arrow = delta < 0 ? "←" : "→";

    if (saveResult === "updated") showMessage(`Updated ✨ ${arrow} Tab ${tabNumber}: ${title}`);
    else if (saveResult === "created") showMessage(`Created 🚀 ${arrow} Tab ${tabNumber}: ${title}`);
    else showMessage(`Switched ${arrow} Tab ${tabNumber}: ${title}`);
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

      const baseLabel =
        t.mode === "explorer"
          ? "EXPLORER"
          : t.mode === "dust"
            ? "DUST"
            : extractFirstLineTitle(t.text, baseMax);

      const dirtyMark = t.mode === "editor" && t.dirty ? " *" : "";
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
  
  // expose to global shortcuts (save / auto-update) to refresh the "*" mark
  renderTabsHandler = renderTabs;

  async function activateTab(
    tabId: string,
    options?: { skipSaveViewport?: boolean }
  ) {
    if (!options?.skipSaveViewport) {
      saveActiveMemoViewport();
    }

    const tab = state.tabs.find((x) => x.id === tabId);
    if (!tab) throw new Error("tab not found");

    state.activeTabId = tabId;

    if (tab.mode === "editor") {
      renderEditor();
      renderTabs();
      setView("editor");
      scrollTabIntoView(tabId);
      focusEditorInputIfVisible();
      return;
    }

    renderTabs();
    setView(tab.mode);
    scrollTabIntoView(tabId);

    if (tab.mode === "explorer") {
      await loadExplorer();
    } else {
      await loadDust();
    }
  }

  async function createNewTab() {
    if (state.tabs.length >= MAX_TABS) {
      showMessage(`MAX ${MAX_TABS} tabs - close one to add.`);
      return;      
    }

    const id = crypto.randomUUID();
    state.tabs.push({
      id,
      mode: "editor",
      text: DEFAULT_TEXT,
      dirty: false,
      currentMemoId: null,
      returnToTabId: null,
    });
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

    if (prev === "editor" && view !== "editor") {
      saveActiveMemoViewport();
    }

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
    if (isEditor) applyEditorPaneMode();
    
    if (isEditor) syncPanesHeight();
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
  
    const nextPreviewWide = !isPreviewWide;
    applyPreviewWide(nextPreviewWide);
    showMessage(nextPreviewWide ? "View: Wide" : "View/Edit: Split");
  };
  
  toggleEditWideHandler = async () => {
    if (state.view !== "editor") {
      showMessage("Edit wide is available in Editor.");
      return;
    }
  
    const nextEditWide = !isEditWide;
    applyEditWide(nextEditWide);
    showMessage(nextEditWide ? "Edit: Wide" : "View/Edit: Split");
  };

  openHeadingListPopupHandler = async () => {
    await openHeadingPopup();
  };

  openFeedbackDialogHandler = async () => {
    await openFeedbackDialog();
  };

  openSearchHandler = async () => {
    console.info("[search] openSearchHandler invoked", {
      view: state.view,
      activeTabMode: activeTab().mode,
      isPreviewWide,
      searchInputExists: !!searchInput,
      searchInputHidden: searchInput.hidden,
      searchInputDisabled: searchInput.disabled,
    });

    trackEvent("search_used", {
      surface:
        state.view === "explorer" || state.view === "dust" ? state.view : "editor",
      trigger: "shortcut",
    });

    if (state.view === "explorer" || state.view === "dust") {
      syncSearchUi();
      searchInput.disabled = false;
      searchInput.focus({ preventScroll: true });
      searchInput.select();
      showMessage(state.view === "explorer" ? "Search in Explorer" : "Search in Dust");
      return;
    }

    await openMemoSearchPopup();
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
  
    // 常時表示
    pseudoTagBar.hidden = false;
  
    if (tags.length === 0) {
      pseudoTagList.innerHTML = "";
      return;
    }
  
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

const loadSavedMemoTagSource = (options: { force?: boolean; updatePopup?: boolean } = {}) => {
  const { force = false, updatePopup = false } = options;

  if (savedMemoTagSourceLoading) return savedMemoTagSourceLoading;

  savedMemoTagSourceLoading = (async () => {
    const session = await getSession();
    const userId = session?.user.id ?? null;

    if (!userId) {
      savedMemoTagSource = [];
      savedMemoTagSourceLoaded = true;
      savedMemoTagSourceUserId = null;
      tagDictBuiltAt = 0;
      rebuildTagDict();
      if (updatePopup) updateTagSuggest();
      return;
    }

    if (!force && savedMemoTagSourceLoaded && savedMemoTagSourceUserId === userId) {
      return;
    }

    const list = await listAllMemoContents({ userId });
    savedMemoTagSource = list;
    savedMemoTagSourceLoaded = true;
    savedMemoTagSourceUserId = userId;

    tagDictBuiltAt = 0;
    rebuildTagDict();
    if (updatePopup) updateTagSuggest();
  })()
    .catch((error) => {
      console.warn("[tags] failed to load saved memo tag source", error);
    })
    .finally(() => {
      savedMemoTagSourceLoading = null;
    });

  return savedMemoTagSourceLoading;
};

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
  // Saved memos. Prefer the full saved-memo tag source once it has been loaded;
  // until then, fall back to the Explorer list if it is already available.
  const savedMemos = savedMemoTagSourceLoaded ? savedMemoTagSource : state.memos;
  for (const m of savedMemos) {
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
let ignoreNextTagSuggestKeyup = false;

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

  // Insert the chosen tag and make sure the caret is outside the active token.
  // If there is already whitespace after the token, move over one delimiter;
  // otherwise add a trailing space. This prevents the popup from reopening
  // immediately after Enter/Tab confirms a suggestion.
  const core = `#${entry.display}`;
  const nextChar = tail[0] ?? "";
  const hasDelimiter = nextChar !== "" && /\s/u.test(nextChar);
  const ins = core + (hasDelimiter ? "" : " ");

  input.value = v.slice(0, start) + ins + tail;
  const newPos = start + ins.length + (hasDelimiter ? 1 : 0);
  input.setSelectionRange(newPos, newPos);

  // trigger normal render pipeline
  suppressSuggestOnce = true;
  input.dispatchEvent(new Event("input"));
  suppressSuggestOnce = false;
  closeTagSuggest();
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

  if (!savedMemoTagSourceLoaded && !savedMemoTagSourceLoading) {
    void loadSavedMemoTagSource({ updatePopup: true });
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

input.addEventListener("blur", () => {
  closeTagSuggest();
  saveActiveMemoViewport();
  memoInputHadFocus = false;
});

input.addEventListener("blur", () => {
  closeTagSuggest();
  saveActiveMemoViewport();
});

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
    ignoreNextTagSuggestKeyup = true;

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
input.addEventListener("keyup", (e) => {
  if (ignoreNextTagSuggestKeyup) {
    ignoreNextTagSuggestKeyup = false;
    if (e.key === "Enter" || e.key === "Tab") {
      closeTagSuggest();
      return;
    }
  }

  updateTagSuggest();
});
input.addEventListener("click", () => updateTagSuggest());

const textareaEditing = registerTextareaEditing(input, {
  isEditorActive: () => state.view === "editor",
});

const sanitizeMemoClipboardText = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "");

input.addEventListener("copy", (e) => {
  if (state.view !== "editor") return;
  if (!e.clipboardData) return;

  const selectionStart = input.selectionStart ?? 0;
  const selectionEnd = input.selectionEnd ?? selectionStart;
  if (selectionStart === selectionEnd) return;

  const selectedText = input.value.slice(selectionStart, selectionEnd);
  const sanitizedText = sanitizeMemoClipboardText(selectedText);
  const needsCustomCopy =
    selectedText.includes("\n") || sanitizedText !== selectedText;

  if (!needsCustomCopy) return;

  e.clipboardData.setData("text/plain", sanitizedText);
  e.preventDefault();
});

  // ---- renderers
  function renderEditor() {
    const tab = activeTab();
    const savedViewport = memoViewportStateByTabId.get(tab.id);

    input.value = tab.text;
    preview.innerHTML = renderPreviewMarkdown(tab.text);
    preview.scrollTop = savedViewport?.previewScrollTop ?? 0;

    if (tab.dirty) msgText.textContent = "Unsaved";
    else if (!msgText.textContent || msgText.textContent === "Unsaved") {
      msgText.textContent = "";
    }

    renderPseudoTags(tab.text);
    restoreActiveMemoViewport(false);
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
        const size = formatBytes(memoSizeBytes(m.content));
        const id = escapeHtml(m.id);
        return `
          <li class="memo-item" data-id="${id}" style="border:1px solid #e3e6ea; border-radius:12px; padding:10px; margin-bottom:10px;">
            <button class="memo-row" data-id="${id}" type="button"
              style="all:unset; cursor:pointer; display:block; width:100%;">
              <div style="font-weight:700;">${title}</div>
              <div style="font-size:12px; color:#666; margin-top:6px;">
                <div>Trashed Date: ${trashed}</div>
                <div>Size:         ${size}</div>
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
  let searchInputHadText = false;
  searchInput.addEventListener("input", () => {
    const v = searchInput.value;
    const hasSearchText = v.trim().length > 0;

    if (
      hasSearchText &&
      !searchInputHadText &&
      (state.view === "explorer" || state.view === "dust")
    ) {
      trackEvent("search_used", { surface: state.view, trigger: "input" });
    }

    searchInputHadText = hasSearchText;

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
    if (!textareaEditing.isApplyingProgrammaticEdit()) {
      textareaEditing.clearUndoStack();
    }

    activeTab().text = input.value;
    setDirty(true);
    preview.innerHTML = renderPreviewMarkdown(activeTab().text);
    renderPseudoTags(input.value);
    renderTabs();
    syncPreviewToCaret();
    saveActiveMemoViewport();
  });

  // Tag autocomplete
  input.addEventListener("input", () => updateTagSuggest());
  
  input.addEventListener("click", () => {
    syncPreviewToCaret();
    saveActiveMemoViewport();
  });

  input.addEventListener("keyup", () => {
    syncPreviewToCaret();
    saveActiveMemoViewport();
  });

  input.addEventListener("scroll", () => {
    syncPreviewToCaret();
    saveActiveMemoViewport();
  });

  input.addEventListener("select", () => {
    saveActiveMemoViewport();
  });

  memoList.addEventListener("click", async (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>("button.memo-row");
    const id = btn?.dataset.id;
    if (!id) return;
  
    state.explorerFocusId = id;
    syncListClasses(memoList, state.explorerFocusId, state.explorerSelectedIds);
    scrollFocusIntoView(memoList, state.explorerFocusId, "auto");
  
    try {
      await openMemoFromExplorer(id);
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

  async function openExplorerTabByShortcut() {
    const session = await getSession();
    if (!session) {
      trackEvent("explorer_opened", {
        result: "auth_required",
        trigger: "shortcut_tab",
      });
      showMessage(t("msgExplorerRequiresSignIn"), 4500);
      openAccountScreen("signin");
      return;
    }

    const r = await autoUpdateIfEditingCurrentMemo();

    if (await activateSpecialTabIfAlreadyOpen("explorer")) {
      trackEvent("explorer_opened", {
        result: "activated",
        trigger: "shortcut_tab",
      });
      showMessage(r === "updated" ? "Updated ✨ — Explorer tab activated" : "Explorer tab activated");
      return;
    }

    const returnToTabId = state.activeTabId;
    const opened = await createSpecialTab("explorer", returnToTabId);
    if (!opened) return;

    trackEvent("explorer_opened", {
      result: "opened",
      trigger: "shortcut_tab",
    });

    showMessage(r === "updated" ? "Updated ✨ — Explorer tab opened" : "Explorer tab opened");
  }
  
  async function openDustTabByShortcut() {
    const session = await getSession();
    if (!session) {
      trackEvent("dust_opened", {
        result: "auth_required",
        trigger: "shortcut_tab",
      });
      showMessage(t("msgDustRequiresSignIn"), 4500);
      openAccountScreen("signin");
      return;
    }

    const r = await autoUpdateIfEditingCurrentMemo();

    if (await activateSpecialTabIfAlreadyOpen("dust")) {
      trackEvent("dust_opened", {
        result: "activated",
        trigger: "shortcut_tab",
      });
      showMessage(r === "updated" ? "Updated ✨ — Dust tab activated" : "Dust tab activated");
      return;
    }

    const returnToTabId = state.activeTabId;
    const opened = await createSpecialTab("dust", returnToTabId);
    if (!opened) return;

    trackEvent("dust_opened", {
      result: "opened",
      trigger: "shortcut_tab",
    });

    showMessage(r === "updated" ? "Updated ✨ — Dust tab opened" : "Dust tab opened");
  }

  async function goExplorer() {
    const session = await getSession();
    if (!session) {
      trackEvent("explorer_opened", {
        result: "auth_required",
        trigger: "button",
      });
      showMessage(t("msgExplorerRequiresSignIn"), 4500);
      openAccountScreen("signin");
      return;
    }

    const r = await autoUpdateIfEditingCurrentMemo();
  
    setView("explorer");
    trackEvent("explorer_opened", { result: "opened", trigger: "button" });
    showMessage(r === "updated" ? "Updated ✨ — Explorer opened" : "Explorer opened");
  
    await loadExplorer();
  }  

  async function goDust() {
    const session = await getSession();
    if (!session) {
      trackEvent("dust_opened", {
        result: "auth_required",
        trigger: "button",
      });
      showMessage(t("msgDustRequiresSignIn"), 4500);
      openAccountScreen("signin");
      return;
    }

    const r = await autoUpdateIfEditingCurrentMemo();
    setView("dust");
    trackEvent("dust_opened", { result: "opened", trigger: "button" });
    showMessage(r === "updated" ? "Updated ✨ — Dust opened" : "Dust opened");
    await loadDust();
  }

  goExplorerHandler = openExplorerTabByShortcut;
  goDustHandler = openDustTabByShortcut;
  
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
      await openMemoFromExplorer(id);
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
      const userId = await requireUserId();
      const memo = await getMemo({ userId, id });
      if (!memo) return;

      const alreadyOpenTab = findOpenMemoTab(id);
      if (!alreadyOpenTab && state.tabs.length >= MAX_TABS) {
        showMessage(`Max ${MAX_TABS} tabs — close one before opening from Dust.`);
        return;
      }

      const title = memoTitleFromContent(memo.content);
      const ok = await keyConfirmDustRestoreAndOpen(
        alreadyOpenTab
          ? `"${title}" is in Dust.\n\nMove this memo to Explorer and switch to the already open tab?`
          : `"${title}" is in Dust.\n\nMove this memo to Explorer and open it in a new tab?`
      );

      if (!ok) {
        showMessage("Canceled.");
        return;
      }

      await restoreMemo({ userId, id });
      state.dustSelectedIds.delete(id);
      state.dustFocusId = null;

      if (alreadyOpenTab) {
        await activateTab(alreadyOpenTab.id);
        showMessage(`Moved to Explorer and switched → ${memoTitleFromContent(alreadyOpenTab.text)}`);
      } else {
        await openMemoInNewEditorTab(memo);
      }

      void loadExplorer();
      void loadDust();
    } catch (e) {
      console.error("open from dust failed", e);
      showMessage("Oops — failed to move/open from Dust 😵‍💫", 2500);
    }
  };

  closeTabHandler = async () => {
    try {
      const tab = activeTab();
      const title = getTabLabel(tab);
  
      // 未保存なら保存してから閉じる
      // 新規タブ（currentMemoId === null）の場合、DEFAULT_TEXTのまま or 白紙なら保存しない
      const norm = (s: string) => s.replaceAll("\r\n", "\n").trim();
      const isNew = tab.currentMemoId === null;
      const isBlankDraft = isNew && norm(tab.text) === "";
      const isDefaultDraft = isNew && norm(tab.text) === norm(DEFAULT_TEXT);
      const needsSave =
        tab.mode === "editor" &&
        (isNew ? (!isBlankDraft && !isDefaultDraft) : tab.dirty);

      const idx = state.tabs.findIndex((t) => t.id === tab.id);
      if (idx < 0) return;
  
      // 最後の1枚なら「空の新規タブ」に置き換える
      if (state.tabs.length === 1) {
        memoViewportStateByTabId.delete(tab.id);
        const newId = crypto.randomUUID();
        state.tabs = [{
          id: newId,
          mode: "editor",
          text: "",
          dirty: false,
          currentMemoId: null,
          returnToTabId: null,
        }];
        state.activeTabId = newId;
  
        await activateTab(newId, { skipSaveViewport: true });
  
        showMessage(needsSave ? `Saved & closed: ${title}` : `Closed: ${title}`);
        return;
      }
  
      const returnToTabId = tab.returnToTabId;

      // タブ削除
      memoViewportStateByTabId.delete(tab.id);
      state.tabs.splice(idx, 1);

      const next =
        (returnToTabId
          ? state.tabs.find((t) => t.id === returnToTabId) ?? null
          : null) ??
        state.tabs[Math.max(0, idx - 1)];

      state.activeTabId = next.id;
  
      await activateTab(next.id, { skipSaveViewport: true });
  
      showMessage(needsSave ? `Saved & closed: ${title}` : `Closed: ${title}`);
    } catch (err) {
      console.error("close tab failed", err);
      showMessage("Oops — close tab failed 😵‍💫", 2500);
    }
  };
  
  const closeActiveMemoTabAfterTrash = async (memoIds: Iterable<string>): Promise<boolean> => {
    const ids = new Set(memoIds);
    const tab = activeTab();

    if (tab.mode !== "editor") return false;
    if (!tab.currentMemoId) return false;
    if (!ids.has(tab.currentMemoId)) return false;

    const idx = state.tabs.findIndex((t) => t.id === tab.id);
    if (idx < 0) return false;

    memoViewportStateByTabId.delete(tab.id);

    // 最後の1枚は、タブ0枚にせず空の新規タブへ置き換える
    if (state.tabs.length === 1) {
      const newId = crypto.randomUUID();
      state.tabs = [{
        id: newId,
        mode: "editor",
        text: "",
        dirty: false,
        currentMemoId: null,
        returnToTabId: null,
      }];
      state.activeTabId = newId;

      await activateTab(newId, { skipSaveViewport: true });
      return true;
    }

    const returnToTabId = tab.returnToTabId;

    state.tabs.splice(idx, 1);

    const next =
      (returnToTabId
        ? state.tabs.find((t) => t.id === returnToTabId) ?? null
        : null) ??
      state.tabs[Math.max(0, idx - 1)];

    state.activeTabId = next.id;
    await activateTab(next.id, { skipSaveViewport: true });

    return true;
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
        const deletedIds = Array.from(state.explorerSelectedIds);

        // sequential for safety
        for (const id of deletedIds) {
          await trashMemo({ userId, id });
        }

        await closeActiveMemoTabAfterTrash(deletedIds);

        state.explorerSelectedIds.clear();
        updateExplorerStateText();

        showMessage("Moved to Dust 🗑️");
        setView("dust");
        await loadDust();
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
      const deletedMemoId = tab.currentMemoId;

      await trashMemo({ userId, id: deletedMemoId });

      await closeActiveMemoTabAfterTrash([deletedMemoId]);

      showMessage("Moved to Dust 🗑️");
      setView("dust");
      await loadDust();
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
  
  openExplorerBtn.addEventListener("click", () => void goExplorer());

  openDustBtn.addEventListener("click", () => void goDust());

  newTabBtn.addEventListener("click", () => {
    if (newTabHandler) void newTabHandler();
    else void createNewTab();
  });

  signinBtn.addEventListener("click", () => {
    openAccountScreen("signin");
  });

  signupBtn.addEventListener("click", () => {
    openAccountScreen("signup");
  });

  accountSettingsBtn.addEventListener("click", () => {
    openAccountSettingsScreen();
  });

  logoutBtn.addEventListener("click", async () => {
    await signOut();
    await refreshHeaderAuthUi();
    await rerender();
  });

  void refreshHeaderAuthUi();

  // ★ DOM生成後、active tab の mode を必ず反映する
  state.view = activeTab().mode;
  setView(state.view);

  void (async () => {
    const session = await getSession();
    if (!session && state.view !== "editor") {
      state.view = "editor";
      setView("editor");
    }

    if (session) {
      void loadSavedMemoTagSource();
    }
    
    if (session && state.view === "explorer") {
      void loadExplorer();
    } else if (session && state.view === "dust") {
      void loadDust();
    }
  })();

  const restoreMemoViewportAfterActivation = () => {
    if (state.view !== "editor") return;
    if (isPreviewWide) return;

    const saved = memoViewportStateByTabId.get(activeTab().id);
    const shouldFocus = !!saved?.hadInputFocus;

    window.setTimeout(() => {
      restoreActiveMemoViewport(shouldFocus);
    }, 0);
  };

  const handleWindowBlur = () => {
    saveActiveMemoViewport();
  };

  const handleWindowFocus = () => {
    restoreMemoViewportAfterActivation();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      saveActiveMemoViewport();
      return;
    }

    if (document.visibilityState === "visible") {
      restoreMemoViewportAfterActivation();
    }
  };

  window.addEventListener("blur", handleWindowBlur);
  window.addEventListener("focus", handleWindowFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  teardownMemoViewportHandlers = () => {
    window.removeEventListener("blur", handleWindowBlur);
    window.removeEventListener("focus", handleWindowFocus);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };

  registerSaveShortcut();
}

export function resetMemoScreenHandlers() {
  goExplorerHandler = null;
  goDustHandler = null;
  newTabHandler = null;
  sortExplorerHandler = null;
  deleteMemoHandler = null;
  closeTabHandler = null;
  switchTabHandler = null;
  switchRelativeTabHandler = null;
  togglePreviewWideHandler = null;
  toggleEditWideHandler = null;
  renderTabsHandler = null;
  openHeadingListPopupHandler = null;
  openSearchHandler = null;
  openFeedbackDialogHandler = null;

  teardownFeedbackDialog?.();
  teardownFeedbackDialog = null;

  teardownPanesResize?.();
  teardownPanesResize = null;

  teardownMemoViewportHandlers?.();
  teardownMemoViewportHandlers = null;
}
