const TAB_CHAR = "\t";

type TextareaUndoSnapshot = {
    value: string;
    selectionStart: number;
    selectionEnd: number;
    scrollTop: number;
    scrollLeft: number;
  };

// コピペせずに新たに記述した
export type TextareaEditingController = {
    clearUndoStack: () => void;
    isApplyingProgrammaticEdit: () => boolean;
};

export type TextareaEditingOptions = {
  isEditorActive: () => boolean;
};

export function getLineStartIndex(value: string, position: number) {
  return value.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
}

function getLineEndIndex(value: string, position: number) {
  const end = value.indexOf("\n", position);
  return end === -1 ? value.length : end;
}

function getOutdentCharCount(line: string): number {
  // Shift+Tab は、本物のタブ文字によるインデントだけを 1 段階戻す。
  // 行頭がタブ文字でなければ何もしない。
  return line.startsWith(TAB_CHAR) ? TAB_CHAR.length : 0;
}

function isMarkdownListLine(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);
}

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

function isTextareaUndoShortcut(e: KeyboardEvent): boolean {
  const key = typeof e.key === "string" ? e.key.toLowerCase() : "";
  if (key !== "z") return false;

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const hasUndoMod = isMac ? e.metaKey : e.ctrlKey;

  return hasUndoMod && !e.altKey && !e.shiftKey;
}

export function registerTextareaEditing(
  input: HTMLTextAreaElement,
  options: TextareaEditingOptions
): TextareaEditingController {
  const textareaUndoStack: TextareaUndoSnapshot[] = [];
  let isApplyingTextareaProgrammaticEdit = false;

  const pushTextareaUndoSnapshot = () => {
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
  };

  const restoreTextareaUndoSnapshot = (snapshot: TextareaUndoSnapshot) => {
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
  };

  const applyTextareaEdit = (
    nextValue: string,
    nextSelectionStart: number,
    nextSelectionEnd: number
  ) => {
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
    if (!options.isEditorActive()) return;
    if ((e as any).isComposing) return;
    if (!isTextareaUndoShortcut(e)) return;

    const snapshot = textareaUndoStack.pop();
    if (!snapshot) return; // 通常のブラウザ undo に任せる

    e.preventDefault();
    restoreTextareaUndoSnapshot(snapshot);
  });

  input.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    if (!options.isEditorActive()) return;
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

  return {
    clearUndoStack: () => {
      textareaUndoStack.length = 0;
    },
    isApplyingProgrammaticEdit: () => isApplyingTextareaProgrammaticEdit,
  };
}