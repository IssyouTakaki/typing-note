// src/main.ts
import "./style.css";
import {
  beginSignUp,
  completeProfileAfterOtp,
  getSession,
  getUser,
  requestSignUpOtp,
  resendSignUpOtp,
  signIn,
  signOut,
  verifyEmailOtp,
  type PendingSignUpDraft,
} from "./repos/authRepo";

import { supabase } from "./lib/supabaseClient";

import {
  createMemo, getMemo, listMemos, listDustMemos, updateMemo, trashMemo, restoreMemo, hardDeleteMemo,
  type MemoRow
} from "./repos/supabaseMemoRepo";

import memoUIHtml from "./templates/memoUI.html?raw";
import mountAuthUIHtml from "./templates/mountAuthUI.html?raw";
import signupUIHtml from "./templates/signupUI.html?raw";
import signupOtpUIHtml from "./templates/signupOtpUI.html?raw";
import resetPasswordUIHtml from "./templates/resetPasswordUI.html?raw";
import termsUIHtml from "./templates/termsUI.html?raw";
import privacyUIHtml from "./templates/privacyUI.html?raw";
import forgotPasswordUIHtml from "./templates/forgotPasswordUI.html?raw";


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

const DEFAULT_TEXT = `# Shortcut List

01. ALT + SHIFT + CONTROL + 1-8 = Go To Tab
02. ALT + SHIFT + CONTROL + 0 = Open Dust Tab
03. ALT + SHIFT + CONTROL + 9 = Open Explorer Tab
04. ALT + SHIFT + CONTROL + S = Save a Memo
05. ALT + SHIFT + CONTROL + T = Create a Memo
06. ALT + SHIFT + CONTROL + D = Delete a Memo
07. ALT + SHIFT + CONTROL + O = Sort on Explorer Tab
08. ALT + SHIFT + CONTROL + SPACE = (Explorer/Dust) Toggle select (multi)
09. (Explorer/Dust) Arrow Up/Down = Move focus
10. (Explorer/Dust) Enter = Open focused memo (when none selected)
11. ALT + SHIFT + CONTROL + V = Toggle Preview Wide (Hide/Show Input)

# Explorer Behavior

- Opening a memo from Explorer reuses the existing tab when that memo is already open.
- The same memo tab is not opened twice.

# Editor

- Tab = Align to the next tab stop
- Shift + Tab = Move selected lines back to the previous tab stop

# Markdown Preview (implemented)

- Headings: # / ## / ###
- Unordered list: - item
- Ordered list: 1. item
- Horizontal rule: ---
- Todo checklist:
  - [ ] unchecked item
  - [x] checked item

Inline code example: \`const x = 1;\`

Code block example:
\`\`\`ts
function hello() {
    console.log("hi");
}
\`\`\`

Todo example:
- [ ] Build
- [x] Preview
- [ ] Release

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

const PASSWORD_POLICY = {
  minLength: 8,
  requireLowercase: true,
  requireUppercase: true,
  requireDigit: true,
  requireSymbol: true,
};

function validatePassword(password: string): string[] {
  const errors: string[] = [];

  if (password.length < PASSWORD_POLICY.minLength) {
    errors.push(`${PASSWORD_POLICY.minLength}文字以上`);
  }
  if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("英小文字を1文字以上");
  }
  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("英大文字を1文字以上");
  }
  if (PASSWORD_POLICY.requireDigit && !/[0-9]/.test(password)) {
    errors.push("数字を1文字以上");
  }
  if (
    PASSWORD_POLICY.requireSymbol &&
    !/[!@#$%^&*()_+\-=\[\]{};':"\\|<>?,./`~]/.test(password)
  ) {
    errors.push("記号を1文字以上");
  }

  return errors;
}

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

type PreviewListItem =
  | { kind: "html"; html: string }
  | { kind: "cols"; marker: string; cells: string[]; indentLevel: number };

function splitPreviewColumns(input: string): string[] | null {
  // 列区切りは「本物のタブ文字」だけにする。
  // 半角スペース複数個は、ただのスペースとして扱う。
  if (!input.includes("\t")) return null;

  const cells = input.split("\t").map((cell) => cell.trim());

  if (cells.length < 2) return null;
  if (cells.every((cell) => cell.length === 0)) return null;

  return cells;
}

function renderPreviewPlainColumnsTable(rows: string[][]): string {
  if (rows.length === 0) return "";

  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);

  const body = rows
    .map((row) => {
      const padded = Array.from({ length: maxCols }, (_, i) => row[i] ?? "");

      return `
        <tr class="md-cols-row">
          ${padded
            .map(
              (cell) =>
                `<td class="md-cols-cell">${cell ? renderInlineCode(cell) : ""}</td>`
            )
            .join("")}
        </tr>
      `;
    })
    .join("");

  return `<table class="md-cols-table md-cols-table-plain"><tbody>${body}</tbody></table>`;
}

function renderPreviewTextBlock(text: string): string {
  return `<pre class="preview-pre">${renderInlineCode(text)}</pre>`;
}

function renderPreviewColumnsTable(
  rows: Array<{ marker: string; cells: string[]; indentLevel?: number }>,
  mode: "ul" | "ol"
): string {
  if (rows.length === 0) return "";

  const maxCols = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);

  const body = rows
    .map((row) => {
      const padded = Array.from({ length: maxCols }, (_, i) => row.cells[i] ?? "");
      const indentStyle = previewTableIndentStyle(row.indentLevel ?? 0);

      return `
        <tr class="md-cols-row">
          <td class="md-cols-marker"${indentStyle}>${escapeHtml(row.marker)}</td>
          ${padded
            .map(
              (cell) =>
                `<td class="md-cols-cell">${cell ? renderInlineCode(cell) : ""}</td>`
            )
            .join("")}
        </tr>
      `;
    })
    .join("");

  return `<table class="md-cols-table md-cols-table-${mode}"><tbody>${body}</tbody></table>`;
}

function renderPreviewList(
  mode: "ul" | "ol",
  items: PreviewListItem[]
): string {
  if (items.length === 0) return "";

  const parts: string[] = [];
  let htmlBuf: string[] = [];
  let colsBuf: Array<{ marker: string; cells: string[]; indentLevel: number }> = [];

  const flushHtml = () => {
    if (htmlBuf.length === 0) return;

    parts.push(
      mode === "ul"
        ? `<ul class="md-ul">${htmlBuf.join("")}</ul>`
        : `<ol class="md-ol">${htmlBuf.join("")}</ol>`
    );

    htmlBuf = [];
  };

  const flushCols = () => {
    if (colsBuf.length === 0) return;
    parts.push(renderPreviewColumnsTable(colsBuf, mode));
    colsBuf = [];
  };

  for (const item of items) {
    if (item.kind === "html") {
      flushCols();
      htmlBuf.push(item.html);
      continue;
    }

    flushHtml();
    colsBuf.push({
      marker: item.marker,
      cells: item.cells,
      indentLevel: item.indentLevel,
    });
  }

  flushHtml();
  flushCols();

  return parts.join("\n");
}

// --- Minimal Markdown (Phase 3): headings + lists + hr + code blocks + inline code + todo checklists
function renderPreviewMarkdown(text: string): string {
  const lines = text.split(/\r?\n/);

  const parts: string[] = [];
  let buf: string[] = [];
  let listMode: "ul" | "ol" | null = null;
  let listItems: PreviewListItem[] = [];

  // fenced code block state
  let inFence = false;
  let fenceLang = "";
  let fenceBuf: string[] = [];

  const flushText = () => {
    if (buf.length === 0) return;
    parts.push(renderPreviewTextBlock(buf.join("\n")));
    buf = [];
  };

  const closeList = () => {
    if (!listMode) return;
    parts.push(renderPreviewList(listMode, listItems));
    listMode = null;
    listItems = [];
  };

  const openList = (mode: "ul" | "ol") => {
    if (listMode === mode) return;
    closeList();
    flushText();
    listMode = mode;
    listItems = [];
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

  const renderTodoItem = (
    content: string,
    checked: boolean,
    indentLevel = 0
  ) => {
    const checkedAttr = checked ? " checked" : "";
    const indentStyle = previewIndentStyle(indentLevel);

    return `<li class="md-li md-li-todo"${indentStyle}><label class="md-todo"><input class="md-todo-checkbox" type="checkbox" disabled${checkedAttr}><span class="md-todo-text">${renderInlineCode(content)}</span></label></li>`;
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

    // todo list: "- [ ] item" / "- [x] item"
    {
      const m = line.match(/^([ \t]*)[-*]\s+\[([ xX])]\s+(.+)$/);
      if (m) {
        const indentLevel = markdownIndentLevel(m[1] ?? "");
        const checked = String(m[2] ?? "").toLowerCase() === "x";
        const content = m[3].trim();

        if (content.length > 0) {
          openList("ul");
          listItems.push({
            kind: "html",
            html: renderTodoItem(content, checked, indentLevel),
          });
          continue;
        }
      }
    }

    // unordered list: "- item"
    {
      const m = line.match(/^([ \t]*)[-*]\s+(.+)$/);
      if (m) {
        const indentLevel = markdownIndentLevel(m[1] ?? "");
        const content = m[2].trim();

        if (content.length > 0) {
          openList("ul");

          const cells = splitPreviewColumns(content);
          if (cells) {
            listItems.push({
              kind: "cols",
              marker: "•",
              cells,
              indentLevel,
            });
          } else {
            listItems.push({
              kind: "html",
              html: `<li class="md-li"${previewIndentStyle(indentLevel)}>${renderInlineCode(content)}</li>`,
            });
          }

          continue;
        }
      }
    }

    // ordered list: "1. item"
    {
      const m = line.match(/^([ \t]*)(\d+)\.\s+(.+)$/);
      if (m) {
        const indentLevel = markdownIndentLevel(m[1] ?? "");
        const marker = `${m[2]}.`;
        const value = m[2];
        const content = m[3].trim();

        if (content.length > 0) {
          openList("ol");

          const cells = splitPreviewColumns(content);
          if (cells) {
            listItems.push({
              kind: "cols",
              marker,
              cells,
              indentLevel,
            });
          } else {
            listItems.push({
              kind: "html",
              html: `<li class="md-li" value="${value}"${previewIndentStyle(indentLevel)}>${renderInlineCode(content)}</li>`,
            });
          }

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
const TAB_STOP = 4;
const TAB_CHAR = "\t";

function getLineStartIndex(value: string, position: number) {
  return value.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
}

function getLineEndIndex(value: string, position: number) {
  const end = value.indexOf("\n", position);
  return end === -1 ? value.length : end;
}

function getLeadingWhitespace(line: string): string {
  return (line.match(/^[ \t]*/) ?? [""])[0];
}

function getOutdentCharCount(line: string): number {
  // Shift+Tab は、本物のタブ文字によるインデントだけを 1 段階戻す。
  // 行頭がタブ文字でなければ何もしない。
  return line.startsWith(TAB_CHAR) ? TAB_CHAR.length : 0;
}

function isMarkdownListLine(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);
}

function markdownIndentLevel(rawIndent: string): number {
  let visual = 0;

  for (const ch of rawIndent) {
    if (ch === "\t") {
      visual += TAB_STOP;
      continue;
    }

    if (ch === " ") {
      visual += 1;
    }
  }

  return Math.floor(visual / TAB_STOP);
}

function previewIndentStyle(indentLevel: number): string {
  if (indentLevel <= 0) return "";
  return ` style="margin-left:${indentLevel * 22}px;"`;
}

function previewTableIndentStyle(indentLevel: number): string {
  if (indentLevel <= 0) return "";
  return ` style="padding-left:${indentLevel * 22}px;"`;
}

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

// let alignIndentShortcutHandler: (() => Promise<void>) | null = null;

let renderTabsHandler: (() => void) | null = null;

let openHeadingListPopupHandler: (() => Promise<void>) | null = null;

// --- List focus / multi-select (Explorer & Dust) ---
let explorerSelectToggleHandler: (() => Promise<void>) | null = null;
let explorerMoveFocusHandler: ((delta: -1 | 1) => Promise<void>) | null = null;
let explorerOpenFocusHandler: (() => Promise<void>) | null = null;
let dustSelectToggleHandler: (() => Promise<void>) | null = null;
let dustMoveFocusHandler: ((delta: -1 | 1) => Promise<void>) | null = null;
let dustOpenFocusHandler: (() => Promise<void>) | null = null;

let teardownPanesResize: (() => void) | null = null;

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

function isHeadingPopupShortcut(e: KeyboardEvent) {
  const keyRow = e.key;
  if (typeof keyRow !== "string") return false;
  if (keyRow.toLowerCase() !== "i") return false;

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
  renderTabsHandler?.();
  return "updated";
}


async function saveIfDirty(): Promise<SaveResult> {

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
    return "auth_required";
  }

  if (tab.currentMemoId) {
    await updateMemo({userId, id: tab.currentMemoId, content: tab.text});
    tab.dirty = false;
    renderTabsHandler?.();
    return "updated";
  } else {

    const created = await createMemo({userId, content: tab.text});
    tab.currentMemoId = created.id;
    tab.dirty = false;
    renderTabsHandler?.();
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

    if (isHeadingPopupShortcut(e)) {
      e.preventDefault();
      if (openHeadingListPopupHandler) void openHeadingListPopupHandler();
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
      else if (result === "auth_required") showMessage("保存にはアカウント作成またはサインインが必要です。", 4500);
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
  appScreen = "memo";
  app.innerHTML = memoUIHtml;

  // ---- elements
  const logoutBtn = qs<HTMLButtonElement>("#logoutBtn");
  const displayNameText = qs<HTMLSpanElement>("#displayNameText");
  const signinBtn = qs<HTMLButtonElement>("#signinBtn");
  const signupBtn = qs<HTMLButtonElement>("#signupBtn");
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
  
    logoutBtn.hidden = !loggedIn;
    signinBtn.hidden = loggedIn;
    signupBtn.hidden = loggedIn;
  
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

  let isPreviewWide = false;
  let memoInputHadFocus = false;

  const clampSelectionPosition = (value: string, position: number) =>
    Math.max(0, Math.min(value.length, position));

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

  const applyPreviewWide = (on: boolean) => {
    if (on) saveActiveMemoViewport();

    inputPane.hidden = on;
    panes.style.gridTemplateColumns = on ? "1fr" : "";

    if (on) {
      if (document.activeElement === input) input.blur();
      return;
    }

    restoreActiveMemoViewport(true);
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
  
  const syncPreviewToCaret = () => {
    const text = input.value;
    const maxScroll = Math.max(0, preview.scrollHeight - preview.clientHeight);
    if (maxScroll <= 0) return;
  
    const caret = Math.max(0, input.selectionStart ?? 0);
    const before = text.slice(0, caret);
    const beforeLines = before.split(/\r?\n/).length - 1;
    const totalLines = text.split(/\r?\n/).length - 1;
  
    let ratio = 0;
    if (totalLines > 0) {
      ratio = beforeLines / totalLines;
    } else if (text.length > 0) {
      ratio = caret / text.length;
    }
  
    preview.scrollTop = Math.max(0, Math.min(maxScroll, maxScroll * ratio));
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


  const openMemoFromExplorer = async (id: string) => {
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
  // --- tab UX helpers (shortcut switching etc.)
  const getTabLabel = (t: TabState) => {
    if (t.mode === "explorer") return "EXPLORER";
    if (t.mode === "dust") return "DUST";
    return memoTitleFromContent(t.text);
  };
  
  // const scrollTabIntoView = (tabId: string, behavior: ScrollBehavior = "smooth") => {
  //   window.requestAnimationFrame(() => {
  //     const btn = Array.from(
  //       tabList.querySelectorAll<HTMLButtonElement>('button[data-tab-id]')
  //     ).find((b) => b.dataset.tabId === tabId);

  //     if (!btn) return;
  //     // Scroll only within the tab list (horizontal)
  //     btn.scrollIntoView({ behavior, block: "nearest", inline: "nearest" });
  //   });
  // };

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
    if (isEditor) applyPreviewWide(isPreviewWide);

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
  
    isPreviewWide = !isPreviewWide;
    applyPreviewWide(isPreviewWide);
    showMessage(isPreviewWide ? "Preview: Wide" : "Preview: Split");
  };

  openHeadingListPopupHandler = async () => {
    await openHeadingPopup();
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

const indentSelectedLines = (value: string, selectionStart: number, selectionEnd: number) => {
  const blockStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  const blockEnd = value.indexOf("\n", selectionEnd);
  const safeBlockEnd = blockEnd === -1 ? value.length : blockEnd;

  const block = value.slice(blockStart, safeBlockEnd);
  const lines = block.split("\n");

  let offset = 0;
  let startShift = 0;
  let endShift = 0;

  const indentedLines = lines.map((line) => {
    const absLineStart = blockStart + offset;
    offset += line.length + 1;

    if (absLineStart < selectionStart) {
      startShift += TAB_CHAR.length;
    }

    if (absLineStart < selectionEnd) {
      endShift += TAB_CHAR.length;
    }

    return TAB_CHAR + line;
  });

  const nextValue =
    value.slice(0, blockStart) +
    indentedLines.join("\n") +
    value.slice(safeBlockEnd);

  return {
    value: nextValue,
    selectionStart: selectionStart + startShift,
    selectionEnd: selectionEnd + endShift,
  };
};

const outdentSelectedLines = (
  value: string,
  selectionStart: number,
  selectionEnd: number
): { value: string; selectionStart: number; selectionEnd: number } | null => {
  const blockStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  const blockEnd = value.indexOf("\n", selectionEnd);
  const safeBlockEnd = blockEnd === -1 ? value.length : blockEnd;

  const block = value.slice(blockStart, safeBlockEnd);
  const lines = block.split("\n");

  let removedBeforeStart = 0;
  let removedTotal = 0;

  const outdentedLines = lines.map((line, index) => {
    const removeCount = getOutdentCharCount(line);

    if (index === 0) {
      const offsetIntoFirstLine = Math.max(0, selectionStart - blockStart);
      removedBeforeStart = Math.min(removeCount, offsetIntoFirstLine);
    }

    removedTotal += removeCount;
    return line.slice(removeCount);
  });

  // 行頭にタブ文字が一つもなければ、何もしない
  if (removedTotal === 0) return null;

  const nextValue =
    value.slice(0, blockStart) +
    outdentedLines.join("\n") +
    value.slice(safeBlockEnd);

  return {
    value: nextValue,
    selectionStart: Math.max(blockStart, selectionStart - removedBeforeStart),
    selectionEnd: Math.max(blockStart, selectionEnd - removedTotal),
  };
};

const applyTextareaEdit = (nextValue: string, nextSelectionStart: number, nextSelectionEnd: number) => {
  pushTextareaUndoSnapshot();

  isApplyingTextareaProgrammaticEdit = true;

  input.value = nextValue;
  input.focus();
  input.setSelectionRange(nextSelectionStart, nextSelectionEnd);

  input.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: null,
    })
  );

  isApplyingTextareaProgrammaticEdit = false;
};

input.addEventListener("keydown", (e) => {
  if (e.defaultPrevented) return;
  if (state.view !== "editor") return;
  if ((e as any).isComposing) return;
  if (!isTextareaUndoShortcut(e)) return;

  const snapshot = textareaUndoStack.pop();
  if (!snapshot) return; // 通常のブラウザ undo に任せる

  e.preventDefault();
  restoreTextareaUndoSnapshot(snapshot);
});

type TextareaUndoSnapshot = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  scrollLeft: number;
};

const textareaUndoStack: TextareaUndoSnapshot[] = [];
let isApplyingTextareaProgrammaticEdit = false;

function pushTextareaUndoSnapshot() {
  textareaUndoStack.push({
    value: input.value,
    selectionStart: input.selectionStart ?? 0,
    selectionEnd: input.selectionEnd ?? input.selectionStart ?? 0,
    scrollTop: input.scrollTop,
    scrollLeft: input.scrollLeft,
  });

  // Tab 操作用の軽量 undo なので、保持しすぎない
  if (textareaUndoStack.length > 50) {
    textareaUndoStack.shift();
  }
}

function restoreTextareaUndoSnapshot(snapshot: TextareaUndoSnapshot) {
  isApplyingTextareaProgrammaticEdit = true;

  input.value = snapshot.value;
  input.focus();
  input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  input.scrollTop = snapshot.scrollTop;
  input.scrollLeft = snapshot.scrollLeft;

  input.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "historyUndo",
    })
  );

  isApplyingTextareaProgrammaticEdit = false;
}

function isTextareaUndoShortcut(e: KeyboardEvent): boolean {
  const key = typeof e.key === "string" ? e.key.toLowerCase() : "";
  if (key !== "z") return false;

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const hasUndoMod = isMac ? e.metaKey : e.ctrlKey;

  return hasUndoMod && !e.altKey && !e.shiftKey;
}

input.addEventListener("keydown", (e) => {
  if (e.defaultPrevented) return;
  if (state.view !== "editor") return;
  if ((e as any).isComposing) return;
  if (e.key !== "Tab") return;

  e.preventDefault();

  const selectionStart = input.selectionStart ?? 0;
  const selectionEnd = input.selectionEnd ?? selectionStart;
  const value = input.value;

  if (selectionStart === selectionEnd) {
    if (e.shiftKey) {
      const edit = outdentSelectedLines(value, selectionStart, selectionEnd);
      if (!edit) return;

      applyTextareaEdit(edit.value, edit.selectionStart, edit.selectionEnd);
      return;
    }

    const lineStart = getLineStartIndex(value, selectionStart);
    const lineEnd = getLineEndIndex(value, selectionStart);
    const line = value.slice(lineStart, lineEnd);

    // 箇条書き行では、カーソル位置ではなく行頭にタブを入れて入れ子化する
    if (isMarkdownListLine(line)) {
      const nextValue =
        value.slice(0, lineStart) +
        TAB_CHAR +
        value.slice(lineStart);

      const nextCaret = selectionStart + TAB_CHAR.length;
      applyTextareaEdit(nextValue, nextCaret, nextCaret);
      return;
    }

    // 通常行では、本物のタブ文字を 1 個だけ挿入する
    const nextValue =
      value.slice(0, selectionStart) +
      TAB_CHAR +
      value.slice(selectionEnd);

    const nextCaret = selectionStart + TAB_CHAR.length;
    applyTextareaEdit(nextValue, nextCaret, nextCaret);
    return;
  }

  if (e.shiftKey) {
    const edit = outdentSelectedLines(value, selectionStart, selectionEnd);
    if (!edit) return;

    applyTextareaEdit(edit.value, edit.selectionStart, edit.selectionEnd);
    return;
  }

  const edit = indentSelectedLines(value, selectionStart, selectionEnd);
  applyTextareaEdit(edit.value, edit.selectionStart, edit.selectionEnd);
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
    if (!isApplyingTextareaProgrammaticEdit) {
      textareaUndoStack.length = 0;
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
      showMessage("Explorer を使うには Sign in が必要です。", 4500);
      openAccountScreen("signin");
      return;
    }

    const returnToTabId = state.activeTabId;
    const r = await autoUpdateIfEditingCurrentMemo();
    const opened = await createSpecialTab("explorer", returnToTabId);
    if (!opened) return;

    showMessage(r === "updated" ? "Updated ✨ — Explorer tab opened" : "Explorer tab opened");
  }
  
  async function openDustTabByShortcut() {
    const session = await getSession();
    if (!session) {
      showMessage("Dust を使うには Sign in が必要です。", 4500);
      openAccountScreen("signin");
      return;
    }

    const returnToTabId = state.activeTabId;
    const r = await autoUpdateIfEditingCurrentMemo();
    const opened = await createSpecialTab("dust", returnToTabId);
    if (!opened) return;

    showMessage(r === "updated" ? "Updated ✨ — Dust tab opened" : "Dust tab opened");
  }

  async function goExplorer() {
    const session = await getSession();
    if (!session) {
      showMessage("Explorer を使うには Sign in が必要です。", 4500);
      openAccountScreen("signin");
      return;
    }

    const r = await autoUpdateIfEditingCurrentMemo();
  
    setView("explorer");
    showMessage(r === "updated" ? "Updated ✨ — Explorer opened" : "Explorer opened");
  
    await loadExplorer();
  }  

  async function goDust() {
    const session = await getSession();
    if (!session) {
      showMessage("Dust を使うには Sign in が必要です。", 4500);
      openAccountScreen("signin");
      return;
    }

    const r = await autoUpdateIfEditingCurrentMemo();
    setView("dust");
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
      await saveIfDirty();
      const userId = await requireUserId();
      const memo = await getMemo({ userId, id });
      if (!memo) return;

      const tab = activeTab();
      tab.mode = "editor";
      tab.currentMemoId = memo.id;
      tab.text = memo.content;
      tab.dirty = false;
      tab.returnToTabId = null;

      await activateTab(tab.id, { skipSaveViewport: true });
      focusMemoStart();
    } catch (e) {
      console.error(e);
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
      memoViewportStateByTabId.delete(tab.id);
  
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

function formatAuthErrorMessage(error: unknown): string {
  const raw =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");

  const normalized = raw.trim().toLowerCase();

  if (normalized.includes("failed to send a request to the edge function")) {
    return "サーバーとの通信に失敗しました。時間をおいて再度お試しください。";
  }

  if (
    normalized.includes("edge function returned a non-2xx status code") ||
    normalized.includes("function returned an error") ||
    normalized.includes("functionshttperror")
  ) {
    return "サインアップ確認処理でエラーが発生しました。設定またはサーバー状態を確認してください。";
  }

  if (normalized.includes("failed to fetch")) {
    return "ネットワーク通信に失敗しました。接続状況を確認して再度お試しください。";
  }

  if (normalized.includes("invalid login credentials")) {
    return "メールアドレスまたはパスワードが正しくありません。";
  }

  if (normalized.includes("email not confirmed")) {
    return "メール確認が完了していません。確認メールのリンクを開いてください。";
  }

  if (normalized.includes("user already registered")) {
    return "このメールアドレスは既に登録されています。";
  }

  if (normalized.includes("password should be at least")) {
    return "パスワードの文字数が不足しています。";
  }

  if (
    normalized.includes("token has expired") ||
    normalized.includes("otp_expired") ||
    normalized.includes("expired")
  ) {
    return "認証コードの有効期限が切れています。コードを再送してください。";
  }

  if (
    normalized.includes("invalid token") ||
    normalized.includes("token not found") ||
    normalized.includes("forbidden")
  ) {
    return "認証コードが正しくありません。入力内容を確認してください。";
  }

  return raw || "認証に失敗しました。";
}

const TERMS_VERSION = "v1";
const PRIVACY_VERSION = "v1";
const PENDING_SIGNUP_STORAGE_KEY = "typingnote.pending-signup";

const PASSWORD_RESET_EMAIL_STORAGE_KEY = "typingnote.password-reset-email";
let forceSignedOutScreen: "memo" | "auth" | null = null;

function savePasswordResetEmail(email: string) {
  if (!canUseLocalStorage()) return;
  localStorage.setItem(PASSWORD_RESET_EMAIL_STORAGE_KEY, email.trim());
}

function loadPasswordResetEmail(): string {
  if (!canUseLocalStorage()) return "";
  return localStorage.getItem(PASSWORD_RESET_EMAIL_STORAGE_KEY) ?? "";
}

function clearPasswordResetEmail() {
  if (!canUseLocalStorage()) return;
  localStorage.removeItem(PASSWORD_RESET_EMAIL_STORAGE_KEY);
}

let authMode: "normal" | "recovery" = "normal";

let appScreen:
  | "memo"
  | "auth"
  | "signup"
  | "signupOtp"
  | "forgotPassword"
  | "terms"
  | "privacy" = "memo";

let legalBackScreen:
  | "memo"
  | "auth"
  | "signup"
  | "signupOtp"
  | "forgotPassword" = "memo";

let authFlashKind: "info" | "error" = "error";

let suppressSignedInRerender = false;

function resetScreenHandlers() {
  goExplorerHandler = null;
  goDustHandler = null;
  newTabHandler = null;
  sortExplorerHandler = null;
  deleteMemoHandler = null;
  closeTabHandler = null;
  switchTabHandler = null;
  togglePreviewWideHandler = null;
  renderTabsHandler = null;
  openHeadingListPopupHandler = null;

  teardownPanesResize?.();
  teardownPanesResize = null;

  teardownMemoViewportHandlers?.();
  teardownMemoViewportHandlers = null;
}

function openAccountScreen(intent: "signin" | "signup", message = "", kind: "info" | "error" = "error") {
  authFlashKind = kind;
  appScreen = intent === "signup" ? "signup" : "auth";
  rerender(message).catch(console.error);
}

function openForgotPasswordScreen(
  message = "",
  kind: "info" | "error" = "error"
) {
  authFlashKind = kind;
  appScreen = "forgotPassword";
  rerender(message).catch(console.error);
}

function openSignupOtpScreen(message = "", kind: "info" | "error" = "info") {
  authFlashKind = kind;
  appScreen = "signupOtp";
  rerender(message).catch(console.error);
}

function openLegalScreen(kind: "terms" | "privacy", backTo: "memo" | "auth" | "signup" | "signupOtp") {
  legalBackScreen = backTo;
  appScreen = kind;
  rerender().catch(console.error);
}

function canUseLocalStorage() {
  try {
    const k = "__tn_ls_test__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function savePendingSignUpDraft(draft: PendingSignUpDraft) {
  if (!canUseLocalStorage()) return;
  localStorage.setItem(PENDING_SIGNUP_STORAGE_KEY, JSON.stringify(draft));
}

function loadPendingSignUpDraft(): PendingSignUpDraft | null {
  if (!canUseLocalStorage()) return null;

  const raw = localStorage.getItem(PENDING_SIGNUP_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PendingSignUpDraft>;
    if (!parsed || typeof parsed.email !== "string") return null;

    return {
      email: String(parsed.email ?? "").trim(),
      password: String(parsed.password ?? ""),
      displayName: String(parsed.displayName ?? "").trim(),
      familyName: String(parsed.familyName ?? "").trim(),
      givenName: String(parsed.givenName ?? "").trim(),
      agreedTermsAt: String(parsed.agreedTermsAt ?? ""),
      termsVersion: String(parsed.termsVersion ?? TERMS_VERSION),
      agreedPrivacyAt: String(parsed.agreedPrivacyAt ?? ""),
      privacyVersion: String(parsed.privacyVersion ?? PRIVACY_VERSION),
    };
  } catch {
    return null;
  }
}

function clearPendingSignUpDraft() {
  if (!canUseLocalStorage()) return;
  localStorage.removeItem(PENDING_SIGNUP_STORAGE_KEY);
}

function buildDisplayName(displayName: string, familyName: string, givenName: string) {
  const direct = displayName.trim();
  if (direct) return direct;
  return [familyName.trim(), givenName.trim()].filter(Boolean).join(" ").trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitForSession = async (timeoutMs = 3000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await getSession();
    if (s) return s;
    await sleep(150);
  }
  return null;
};

// function openAccountScreen(intent: "signin" | "signup", message = "") {
//   authScreenIntent = intent;
//   appScreen = "auth";
//   rerender(message).catch(console.error);
// }

function mountSignUpUI(app: HTMLDivElement, message = "") {
  resetScreenHandlers();
  app.innerHTML = signupUIHtml;

  const msgEl = qs<HTMLDivElement>("#signupMsg");
  const form = qs<HTMLFormElement>("#signupForm");
  const displayNameEl = qs<HTMLInputElement>("#signupDisplayName");
  const familyNameEl = qs<HTMLInputElement>("#signupFamilyName");
  const givenNameEl = qs<HTMLInputElement>("#signupGivenName");
  const emailEl = qs<HTMLInputElement>("#signupEmail");
  const passEl = qs<HTMLInputElement>("#signupPassword");
  const pass2El = qs<HTMLInputElement>("#signupPassword2");
  const agreeTermsEl = qs<HTMLInputElement>("#agreeTerms");
  const agreePrivacyEl = qs<HTMLInputElement>("#agreePrivacy");
  const submitBtn = qs<HTMLButtonElement>("#signupSubmitBtn");
  const backBtn = qs<HTMLButtonElement>("#signupBackBtn");
  const topBtn = qs<HTMLButtonElement>("#signupTopBtn");
  const openTermsBtn = qs<HTMLButtonElement>("#openTermsBtn");
  const openPrivacyBtn = qs<HTMLButtonElement>("#openPrivacyBtn");

  // const draft = loadPendingSignUpDraft();
  // if (draft) {
  //   displayNameEl.value = draft.displayName;
  //   familyNameEl.value = draft.familyName;
  //   givenNameEl.value = draft.givenName;
  //   emailEl.value = draft.email;
  //   passEl.value = draft.password;
  //   pass2El.value = draft.password;
  //   agreeTermsEl.checked = !!draft.agreedTermsAt;
  //   agreePrivacyEl.checked = !!draft.agreedPrivacyAt;
  // }

  const setMsg = (t: string, kind: "info" | "error" = "error") => {
    if (!t) {
      msgEl.hidden = true;
      msgEl.textContent = "";
      return;
    }
    msgEl.hidden = false;
    msgEl.textContent = t;
    msgEl.style.color = kind === "error" ? "#b00020" : "#0b6b2e";
  };

  if (message) setMsg(message, authFlashKind);
  else setMsg("");

  let busy = false;
  const setBusy = (v: boolean) => {
    busy = v;
    submitBtn.disabled = v;
    backBtn.disabled = v;
    topBtn.disabled = v;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;

    const displayName = buildDisplayName(displayNameEl.value, familyNameEl.value, givenNameEl.value);
    const familyName = familyNameEl.value.trim();
    const givenName = givenNameEl.value.trim();
    const email = emailEl.value.trim();
    const password = passEl.value;
    const password2 = pass2El.value;

    if (!displayName) {
      setMsg("Display name を入力してください。", "error");
      return;
    }

    if (!email) {
      setMsg("Email を入力してください。", "error");
      return;
    }

    if (!password) {
      setMsg("Password を入力してください。", "error");
      return;
    }

    if (password !== password2) {
      setMsg("Password と Confirm password が一致していません。", "error");
      return;
    }
    
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      setMsg(`Password の条件を満たしていません: ${passwordErrors.join("、")}`, "error");
      return;
    }

    if (!agreeTermsEl.checked || !agreePrivacyEl.checked) {
      setMsg("利用規約とプライバシーポリシーへの同意が必要です。", "error");
      return;
    }

    const agreedAt = new Date().toISOString();
    const nextDraft: PendingSignUpDraft = {
      email,
      password,
      displayName,
      familyName,
      givenName,
      agreedTermsAt: agreedAt,
      termsVersion: TERMS_VERSION,
      agreedPrivacyAt: agreedAt,
      privacyVersion: PRIVACY_VERSION,
    };

    try {
      setBusy(true);
      setMsg("メールアドレスを確認しています...", "info");
    
      const result = await beginSignUp(nextDraft);
    
      if (result.status === "already_registered") {
        setMsg(result.message, "error");
        return;
      }
    
      if (result.status === "otp_sent") {
        savePendingSignUpDraft(nextDraft);
        openSignupOtpScreen(
          "認証コードをメールで送信しました。メールに届いた 8 桁コードを入力してください。",
          "info"
        );
        return;
      }
    
      setMsg(result.message || "認証コードの送信に失敗しました。", "error");
    } catch (err: any) {
      console.error(err);
      setMsg(formatAuthErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  });

  backBtn.addEventListener("click", async () => {
    openAccountScreen("signin");
  });

  topBtn.addEventListener("click", async () => {
    appScreen = "memo";
    await rerender();
  });

  openTermsBtn.addEventListener("click", () => {
    openLegalScreen("terms", "signup");
  });
  
  openPrivacyBtn.addEventListener("click", () => {
    openLegalScreen("privacy", "signup");
  });
}

function mountSignUpOtpUI(app: HTMLDivElement, message = "") {
  resetScreenHandlers();
  app.innerHTML = signupOtpUIHtml;

  const msgEl = qs<HTMLDivElement>("#signupOtpMsg");
  const helpEl = qs<HTMLDivElement>("#signupOtpHelp");
  const form = qs<HTMLFormElement>("#signupOtpForm");
  const emailEl = qs<HTMLInputElement>("#signupOtpEmail");
  const codeEl = qs<HTMLInputElement>("#signupOtpCode");
  const verifyBtn = qs<HTMLButtonElement>("#signupOtpVerifyBtn");
  const resendBtn = qs<HTMLButtonElement>("#signupOtpResendBtn");
  const backBtn = qs<HTMLButtonElement>("#signupOtpBackBtn");
  const topBtn = qs<HTMLButtonElement>("#signupOtpTopBtn");

  const draft = loadPendingSignUpDraft();

  const setMsg = (t: string, kind: "info" | "error" = "error") => {
    if (!t) {
      msgEl.hidden = true;
      msgEl.textContent = "";
      return;
    }
    msgEl.hidden = false;
    msgEl.textContent = t;
    msgEl.style.color = kind === "error" ? "#b00020" : "#0b6b2e";
  };

  if (!draft) {
    emailEl.value = "";
    helpEl.textContent = "先にアカウント作成画面からメールアドレスを入力してください。";
    verifyBtn.disabled = true;
    resendBtn.disabled = true;
    setMsg("アカウント作成情報が見つかりません。入力画面からやり直してください。", "error");
  } else {
    emailEl.value = draft.email;
    helpEl.textContent = `${draft.email} に送信された 8 桁の認証コードを入力してください。`;
    if (message) setMsg(message, authFlashKind);
    else setMsg("");
  }

  let busy = false;
  const setBusy = (v: boolean) => {
    busy = v;
    verifyBtn.disabled = v || !draft;
    resendBtn.disabled = v || !draft;
    backBtn.disabled = v;
    topBtn.disabled = v;
  };

  codeEl.addEventListener("input", () => {
    codeEl.value = codeEl.value.replace(/\D+/g, "").slice(0, 8);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || !draft) return;

    const code = codeEl.value.trim();
    if (!/^\d{8}$/.test(code)) {
      setMsg("8 桁の認証コードを入力してください。", "error");
      return;
    }

    try {
      setBusy(true);
      setMsg("認証しています...", "info");
      suppressSignedInRerender = true;
      await verifyEmailOtp(draft.email, code);
      await completeProfileAfterOtp(draft);
      clearPendingSignUpDraft();
      suppressSignedInRerender = false;
      appScreen = "memo";
      await rerender();
    } catch (err: any) {
      suppressSignedInRerender = false;
      console.error(err);
      setMsg(formatAuthErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  });

  resendBtn.addEventListener("click", async () => {
    if (busy || !draft) return;
    try {
      setBusy(true);
      setMsg("認証コードを再送しています...", "info");
      await resendSignUpOtp(draft);
      setMsg("認証コードを再送しました。最新のメールを確認してください。", "info");
    } catch (err: any) {
      console.error(err);
      setMsg(formatAuthErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  });

  // backBtn.addEventListener("click", async () => {
  //   if (busy) return;
  //   openAccountScreen("signup");
  // });

  // topBtn.addEventListener("click", async () => {
  //   if (busy) return;
  //   appScreen = "memo";
  //   await rerender();
  // });
}

function mountAuthUI(app: HTMLDivElement, message = "") {
  resetScreenHandlers();
  app.innerHTML = mountAuthUIHtml;

  const msgEl = qs<HTMLDivElement>("#authMsg");
  const form = qs<HTMLFormElement>("#authForm");
  const emailEl = qs<HTMLInputElement>("#email");
  const passEl = qs<HTMLInputElement>("#password");
  const signupBtn = qs<HTMLButtonElement>("#signupBtn");
  const signinBtn = qs<HTMLButtonElement>("#signinBtn");
  const forgotBtn = qs<HTMLButtonElement>("#forgotBtn");
  const backToTopBtn = qs<HTMLButtonElement>("#backToTopBtn");
  const openTermsFromAuthBtn = qs<HTMLButtonElement>("#openTermsFromAuthBtn");
  const openPrivacyFromAuthBtn = qs<HTMLButtonElement>("#openPrivacyFromAuthBtn");

  const savedResetEmail = loadPasswordResetEmail();
  if (savedResetEmail && !emailEl.value) {
    emailEl.value = savedResetEmail;
  }

  const setMsg = (t: string, kind: "info" | "error" = "error") => {
    if (!t) {
      msgEl.hidden = true;
      msgEl.textContent = "";
      return;
    }
    msgEl.hidden = false;
    msgEl.textContent = t;
    msgEl.style.color = kind === "error" ? "#b00020" : "#0b6b2e";
  };

  if (message) setMsg(message, authFlashKind);
  else setMsg("");

  let busy = false;
  const setBusy = (v: boolean) => {
    busy = v;
    signupBtn.disabled = v;
    signinBtn.disabled = v;
    forgotBtn.disabled = v;
    backToTopBtn.disabled = v;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;

    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password) {
      setMsg("Email と Password を入力してください。", "error");
      return;
    }

    const started = performance.now();
    console.groupCollapsed(`[auth] SignIn attempt ${new Date().toISOString()}`);
    console.log("email:", email);
    console.log("href:", window.location.href);
    console.log("BASE_URL:", import.meta.env.BASE_URL);
    console.log("localStorage ok:", canUseLocalStorage());

    try {
      setBusy(true);
      setMsg("Signing in...", "info");
      const res = await signIn(email, password);
      console.log("signIn result:", {
        hasSessionInReturn: !!(res as any)?.session,
        userId: (res as any)?.user?.id ?? null,
      });

      const s = await waitForSession(3000);
      console.log("session after wait:", {
        hasSession: !!s,
        userId: s?.user?.id ?? null,
      });

      if (!s) {
        setMsg(
          "サインイン処理は完了しましたが、session が確立できませんでした。\n" +
            "（localStorage の制限 / Supabase URL・KEY の不一致 / 通信制限 等の可能性）\n" +
            "コンソールの [auth] ログを確認してください。",
          "error"
        );
        return;
      }

      setMsg("");
      appScreen = "memo";
      await rerender();
    } catch (e2: any) {
      console.error(e2);
      setMsg(formatAuthErrorMessage(e2), "error");
    } finally {
      console.log("took(ms):", Math.round(performance.now() - started));
      console.groupEnd();
      setBusy(false);
    }
  });

  signupBtn.addEventListener("click", async () => {
    if (busy) return;
    openAccountScreen("signup");
  });

  forgotBtn.addEventListener("click", async () => {
    if (busy) return;
  
    const email = emailEl.value.trim();
    if (email) savePasswordResetEmail(email);
  
    openForgotPasswordScreen();
  });

  backToTopBtn.addEventListener("click", async () => {
    appScreen = "memo";
    await rerender();
  });

  openTermsFromAuthBtn.addEventListener("click", () => {
    openLegalScreen("terms", "auth");
  });
  
  openPrivacyFromAuthBtn.addEventListener("click", () => {
    openLegalScreen("privacy", "auth");
  });
}

function mountForgotPasswordUI(app: HTMLDivElement, message = "") {
  resetScreenHandlers();
  app.innerHTML = forgotPasswordUIHtml;

  const msgEl = qs<HTMLDivElement>("#forgotPasswordMsg");
  const form = qs<HTMLFormElement>("#forgotPasswordForm");
  const emailEl = qs<HTMLInputElement>("#forgotPasswordEmail");
  const submitBtn = qs<HTMLButtonElement>("#forgotPasswordSubmitBtn");
  const backBtn = qs<HTMLButtonElement>("#forgotPasswordBackBtn");
  const topBtn = qs<HTMLButtonElement>("#forgotPasswordTopBtn");

  const setMsg = (t: string, kind: "info" | "error" = "error") => {
    if (!t) {
      msgEl.hidden = true;
      msgEl.textContent = "";
      return;
    }
    msgEl.hidden = false;
    msgEl.textContent = t;
    msgEl.style.color = kind === "error" ? "#b00020" : "#0b6b2e";
  };

  emailEl.value = loadPasswordResetEmail();

  if (message) setMsg(message, authFlashKind);
  else setMsg("");

  let busy = false;
  const setBusy = (v: boolean) => {
    busy = v;
    submitBtn.disabled = v;
    backBtn.disabled = v;
    topBtn.disabled = v;
    emailEl.disabled = v;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;

    const email = emailEl.value.trim();
    if (!email) {
      setMsg("メールアドレスを入力してください。", "error");
      return;
    }

    try {
      setBusy(true);
      setMsg("再設定リンクを送信しています...", "info");

      savePasswordResetEmail(email);

      const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;

      setMsg(
        "パスワード再設定用リンクを送信しました。\nメール内のリンクを開いて、新しいパスワードを設定してください。",
        "info"
      );
    } catch (err: any) {
      console.error(err);
      setMsg(formatAuthErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  });

  backBtn.addEventListener("click", async () => {
    openAccountScreen("signin");
  });

  topBtn.addEventListener("click", async () => {
    appScreen = "memo";
    await rerender();
  });
}

function mountTermsUI(app: HTMLDivElement) {
  resetScreenHandlers();
  app.innerHTML = termsUIHtml;

  const backBtn = qs<HTMLButtonElement>("#termsBackBtn");
  backBtn.addEventListener("click", async () => {
    appScreen = legalBackScreen;
    await rerender();
  });
}

function mountPrivacyUI(app: HTMLDivElement) {
  resetScreenHandlers();
  app.innerHTML = privacyUIHtml;

  const backBtn = qs<HTMLButtonElement>("#privacyBackBtn");
  backBtn.addEventListener("click", async () => {
    appScreen = legalBackScreen;
    await rerender();
  });
}

function mountResetPasswordUI(app: HTMLDivElement) {
  resetScreenHandlers();
  app.innerHTML = resetPasswordUIHtml;

  const msg = qs<HTMLDivElement>("#resetMsg");
  const p1 = qs<HTMLInputElement>("#newPassword");
  const p2 = qs<HTMLInputElement>("#newPassword2");
  const form = qs<HTMLFormElement>("#resetForm");
  const submitBtn = qs<HTMLButtonElement>("#resetBtn");
  const goSigninBtn = qs<HTMLButtonElement>("#goSigninAfterResetBtn");

  const show = (t: string, kind: "info" | "error" = "error") => {
    msg.hidden = false;
    msg.textContent = t;
    msg.style.color = kind === "error" ? "#b00020" : "#0b6b2e";
  };

  let completed = false;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (completed) return;

    const a = p1.value;
    const b = p2.value;

    if (!a || !b) return show("新しいパスワードを入力してください。");
    if (a !== b) return show("確認用パスワードが一致しません。");

    const passwordErrors = validatePassword(a);
    if (passwordErrors.length > 0) {
      return show(`パスワードの条件を満たしていません: ${passwordErrors.join("、")}`);
    }

    submitBtn.disabled = true;
    p1.disabled = true;
    p2.disabled = true;

    try {
      const { error } = await supabase.auth.updateUser({ password: a });
      if (error) throw error;

      completed = true;
      show(
        "パスワードを更新しました。\nセキュリティのため、再度ログインしてください。",
        "info"
      );

      goSigninBtn.hidden = false;
    } catch (err: any) {
      console.error(err);
      submitBtn.disabled = false;
      p1.disabled = false;
      p2.disabled = false;
      show(formatAuthErrorMessage(err));
    }
  });

  goSigninBtn.addEventListener("click", async () => {
    forceSignedOutScreen = "auth";
    authMode = "normal";
    await supabase.auth.signOut();

    openAccountScreen(
      "signin",
      "パスワードが更新されました。新しいパスワードでログインしてください。",
      "info"
    );
  });
}

async function rerender(message = "") {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("#app not found");

  if (authMode === "recovery") {
    mountResetPasswordUI(app);
    return;
  }

  if (appScreen === "auth") {
    mountAuthUI(app, message);
    return;
  }

  if (appScreen === "forgotPassword") {
    mountForgotPasswordUI(app, message);
    return;
  }

  if (appScreen === "signup") {
    mountSignUpUI(app, message);
    return;
  }

  if (appScreen === "signupOtp") {
    mountSignUpOtpUI(app, message);
    return;
  }

  if (appScreen === "terms") {
    mountTermsUI(app);
    return;
  }
  
  if (appScreen === "privacy") {
    mountPrivacyUI(app);
    return;
  }

  mountMemoUI(app);
}


async function mount() {
  supabase.auth.onAuthStateChange((event, session) => {
    console.log("[auth] onAuthStateChange:", event, {
      hasSession: !!session,
      userId: session?.user?.id ?? null,
    });
  
    if (event === "PASSWORD_RECOVERY") {
      authMode = "recovery";
      rerender().catch(console.error);
      return;
    }
  
    if (event === "SIGNED_IN") {
      authMode = "normal";
      if (suppressSignedInRerender) return;
      appScreen = "memo";
      rerender().catch(console.error);
      return;
    }
  
    if (event === "SIGNED_OUT") {
      authMode = "normal";
      appScreen = forceSignedOutScreen ?? "memo";
      forceSignedOutScreen = null;
      rerender().catch(console.error);
      return;
    }
  });

  await rerender();
}


mount().catch(console.error);
