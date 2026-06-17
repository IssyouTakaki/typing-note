import { escapeHtml } from "../utils/html";

const TAB_STOP = 4;

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

function normalizeMarkdownHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) return null;

  // protocol 部分の空白・制御文字をつぶして javascript: などの混入を防ぐ。
  const compact = href.replace(/[\u0000-\u001F\u007F\s]+/g, "").toLowerCase();

  if (/^(https?:|mailto:|tel:)/.test(compact)) return href;
  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) {
    return href;
  }

  // foo/bar のような相対 URL は許可。scheme: 形式は上の allowlist 以外は拒否。
  if (!/^[a-z][a-z0-9+.-]*:/i.test(compact)) return href;

  return null;
}

function tryParseMarkdownLink(
  input: string,
  startIndex: number
): { html: string; nextIndex: number } | null {
  if (input[startIndex] !== "[") return null;

  const labelEnd = input.indexOf("]", startIndex + 1);
  if (labelEnd === -1 || input[labelEnd + 1] !== "(") return null;

  const hrefEnd = input.indexOf(")", labelEnd + 2);
  if (hrefEnd === -1) return null;

  const label = input.slice(startIndex + 1, labelEnd);
  const href = normalizeMarkdownHref(input.slice(labelEnd + 2, hrefEnd));
  if (!label || !href) return null;

  const targetAttrs = href.startsWith("#")
    ? ""
    : ' target="_blank" rel="noopener noreferrer"';

  return {
    html: `<a class="md-link" href="${escapeHtml(href)}"${targetAttrs}>${renderInlineMarkdown(label, false)}</a>`,
    nextIndex: hrefEnd + 1,
  };
}

function tryParseMarkdownStrong(
  input: string,
  startIndex: number,
  allowLinks: boolean
): { html: string; nextIndex: number } | null {
  if (!input.startsWith("**", startIndex)) return null;

  const contentStart = startIndex + 2;
  const contentEnd = input.indexOf("**", contentStart);
  if (contentEnd === -1) return null;

  const content = input.slice(contentStart, contentEnd);
  if (!content) return null;

  return {
    html: `<strong class="md-strong">${renderInlineMarkdown(content, allowLinks)}</strong>`,
    nextIndex: contentEnd + 2,
  };
}

function renderInlineMarkdown(input: string, allowLinks = true): string {
  // `code` / **bold** / [label](url) を変換し、それ以外は escape
  // ※インラインコード内では、太字・リンク記法を解釈しない。
  let out = "";
  let i = 0;

  while (i < input.length) {
    const codeStart = input.indexOf("`", i);
    const strongStart = input.indexOf("**", i);
    const linkStart = allowLinks ? input.indexOf("[", i) : -1;

    if (codeStart === -1 && strongStart === -1 && linkStart === -1) {
      out += escapeHtml(input.slice(i));
      break;
    }

    const starts = [codeStart, strongStart, linkStart].filter((x) => x !== -1);
    const next = Math.min(...starts);
    out += escapeHtml(input.slice(i, next));

    if (next === codeStart) {
      const codeEnd = input.indexOf("`", codeStart + 1);
      if (codeEnd === -1) {
        out += escapeHtml(input.slice(codeStart));
        break;
      }

      const code = input.slice(codeStart + 1, codeEnd);
      out += `<code class="md-code-inline">${escapeHtml(code)}</code>`;
      i = codeEnd + 1;
      continue;
    }

    if (next === strongStart) {
      const parsedStrong = tryParseMarkdownStrong(input, strongStart, allowLinks);
      if (parsedStrong) {
        out += parsedStrong.html;
        i = parsedStrong.nextIndex;
        continue;
      }

      out += escapeHtml(input.slice(strongStart, strongStart + 2));
      i = strongStart + 2;
      continue;
    }

    const parsedLink = tryParseMarkdownLink(input, linkStart);
    if (parsedLink) {
      out += parsedLink.html;
      i = parsedLink.nextIndex;
      continue;
    }

    out += escapeHtml(input.charAt(linkStart));
    i = linkStart + 1;
  }

  return out;
}

function renderInlineCode(input: string): string {
  return renderInlineMarkdown(input);
}

function sourceLineAttrs(startLine: number, endLine = startLine): string {
  return ` data-source-line="${startLine}" data-source-line-start="${startLine}" data-source-line-end="${endLine}"`;
}

type PreviewListItem =
  | { kind: "html"; html: string }
  | { kind: "cols"; marker: string; cells: string[]; indentLevel: number; sourceLine: number };

function splitPreviewColumns(input: string): string[] | null {
  // 列区切りは「本物のタブ文字」だけにする。
  // 半角スペース複数個は、ただのスペースとして扱う。
  if (!input.includes("\t")) return null;

  const cells = input.split("\t").map((cell) => cell.trim());

  if (cells.length < 2) return null;
  if (cells.every((cell) => cell.length === 0)) return null;

  return cells;
}

type MarkdownTableAlign = "left" | "center" | "right" | null;

function splitMarkdownTableRow(line: string): string[] | null {
  if (!line.includes("|")) return null;

  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|") && !source.endsWith("\\|")) source = source.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  let inCode = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "\\" && next === "|") {
      current += "|";
      i++;
      continue;
    }

    if (ch === "`") {
      inCode = !inCode;
      current += ch;
      continue;
    }

    if (ch === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(current.trim());

  if (cells.length < 2) return null;
  return cells;
}

function parseMarkdownTableSeparator(line: string): MarkdownTableAlign[] | null {
  const cells = splitMarkdownTableRow(line);
  if (!cells || cells.length < 2) return null;

  const aligns: MarkdownTableAlign[] = [];

  for (const rawCell of cells) {
    const cell = rawCell.replace(/\s+/g, "");
    if (!/^:?-{3,}:?$/.test(cell)) return null;

    const starts = cell.startsWith(":");
    const ends = cell.endsWith(":");

    if (starts && ends) aligns.push("center");
    else if (ends) aligns.push("right");
    else if (starts) aligns.push("left");
    else aligns.push(null);
  }

  return aligns;
}

function markdownTableAlignClass(align: MarkdownTableAlign): string {
  if (!align) return "";
  return ` md-table-align-${align}`;
}

function renderMarkdownTable(
  headerCells: string[],
  aligns: MarkdownTableAlign[],
  rows: Array<{ cells: string[]; sourceLine: number }>,
  sourceLineStart: number
): string {
  const maxCols = Math.max(
    headerCells.length,
    aligns.length,
    ...rows.map((row) => row.cells.length)
  );

  const normalizedHeader = Array.from({ length: maxCols }, (_, i) => headerCells[i] ?? "");
  const sourceLineEnd = sourceLineStart + rows.length + 1;

  const thead = `
    <thead>
      <tr${sourceLineAttrs(sourceLineStart)}>
        ${normalizedHeader
          .map((cell, i) => `<th class="md-table-cell${markdownTableAlignClass(aligns[i] ?? null)}">${renderInlineCode(cell)}</th>`)
          .join("")}
      </tr>
    </thead>
  `;

  const tbody = rows.length
    ? `
      <tbody>
        ${rows
          .map((row) => {
            const normalizedRow = Array.from({ length: maxCols }, (_, i) => row.cells[i] ?? "");
            return `
              <tr${sourceLineAttrs(row.sourceLine)}>
                ${normalizedRow
                  .map((cell, i) => `<td class="md-table-cell${markdownTableAlignClass(aligns[i] ?? null)}">${renderInlineCode(cell)}</td>`)
                  .join("")}
              </tr>
            `;
          })
          .join("")}
      </tbody>
    `
    : "";

  return `<div class="md-table-wrap"${sourceLineAttrs(sourceLineStart, sourceLineEnd)}><table class="md-table">${thead}${tbody}</table></div>`;
}

function renderPreviewTextBlock(text: string, sourceLineStart: number, sourceLineEnd: number): string {
  return `<pre class="preview-pre"${sourceLineAttrs(sourceLineStart, sourceLineEnd)}>${renderInlineCode(text)}</pre>`;
}

function renderPreviewColumnsTable(
  rows: Array<{ marker: string; cells: string[]; indentLevel?: number; sourceLine: number }>,
  mode: "ul" | "ol"
): string {
  if (rows.length === 0) return "";

  const maxCols = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);

  const body = rows
    .map((row) => {
      const padded = Array.from({ length: maxCols }, (_, i) => row.cells[i] ?? "");
      const indentStyle = previewTableIndentStyle(row.indentLevel ?? 0);

      return `
        <tr class="md-cols-row"${sourceLineAttrs(row.sourceLine)}>
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
  let colsBuf: Array<{ marker: string; cells: string[]; indentLevel: number; sourceLine: number }> = [];

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
      sourceLine: item.sourceLine,
    });
  }

  flushHtml();
  flushCols();

  return parts.join("\n");
}

// --- Minimal Markdown (Phase 3): headings + lists + hr + code blocks + inline code + todo checklists
export function renderPreviewMarkdown(text: string): string {
  const lines = text.split(/\r?\n/);

  const parts: string[] = [];
  let buf: string[] = [];
  let bufStartLine: number | null = null;
  let listMode: "ul" | "ol" | null = null;
  let listItems: PreviewListItem[] = [];

  // fenced code block state
  let inFence = false;
  let fenceLang = "";
  let fenceBuf: string[] = [];
  let fenceStartLine = 0;

  const pushTextLine = (line: string, sourceLine: number) => {
    if (buf.length === 0) bufStartLine = sourceLine;
    buf.push(line);
  };

  const flushText = () => {
    if (buf.length === 0) return;
    const startLine = bufStartLine ?? 0;
    parts.push(renderPreviewTextBlock(buf.join("\n"), startLine, startLine + buf.length - 1));
    buf = [];
    bufStartLine = null;
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

  const flushFence = (sourceLineEnd: number) => {
    const code = escapeHtml(fenceBuf.join("\n"));
    const langAttr = fenceLang ? ` data-lang="${escapeHtml(fenceLang)}"` : "";
    parts.push(
      `<pre class="md-codeblock"${sourceLineAttrs(fenceStartLine, sourceLineEnd)}${langAttr}><code class="md-code">${code}</code></pre>`
    );
    fenceBuf = [];
    fenceLang = "";
  };

  const renderTodoItem = (
    content: string,
    checked: boolean,
    indentLevel: number,
    sourceLine: number
  ) => {
    const checkedAttr = checked ? " checked" : "";
    const indentStyle = previewIndentStyle(indentLevel);

    return `<li class="md-li md-li-todo"${sourceLineAttrs(sourceLine)}${indentStyle}><label class="md-todo"><input class="md-todo-checkbox" type="checkbox" disabled${checkedAttr}><span class="md-todo-text">${renderInlineCode(content)}</span></label></li>`;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
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
        fenceStartLine = lineIndex;
      } else {
        // close fence
        inFence = false;
        flushFence(lineIndex);
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
      parts.push(`<hr class="md-hr"${sourceLineAttrs(lineIndex)}>`);
      continue;
    }

    // blank line
    if (line.trim() === "") {
      if (listMode) {
        closeList();
        parts.push(`<div class="md-blank"${sourceLineAttrs(lineIndex)}></div>`);
      } else {
        if (buf.length === 0) parts.push(`<div class="md-blank"${sourceLineAttrs(lineIndex)}></div>`);
        else pushTextLine("", lineIndex);
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
            `<h${level} class="md-h${level}"${sourceLineAttrs(lineIndex)}>${renderInlineCode(content)}</h${level}>`
          );
          continue;
        }
      }
    }

        // markdown table:
    // | Header | Header |
    // | --- | --- |
    // | Cell | Cell |
    {
      const headerCells = splitMarkdownTableRow(line);
      const aligns = parseMarkdownTableSeparator(lines[lineIndex + 1] ?? "");

      if (headerCells && aligns) {
        const rows: Array<{ cells: string[]; sourceLine: number }> = [];
        let nextIndex = lineIndex + 2;

        while (nextIndex < lines.length) {
          const rowCells = splitMarkdownTableRow(lines[nextIndex] ?? "");
          if (!rowCells) break;
          rows.push({ cells: rowCells, sourceLine: nextIndex });
          nextIndex++;
        }

        closeList();
        flushText();
        parts.push(renderMarkdownTable(headerCells, aligns, rows, lineIndex));
        lineIndex = nextIndex - 1;
        continue;
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
            html: renderTodoItem(content, checked, indentLevel, lineIndex),
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
              sourceLine: lineIndex,
            });
          } else {
            listItems.push({
              kind: "html",
              html: `<li class="md-li"${sourceLineAttrs(lineIndex)}${previewIndentStyle(indentLevel)}>${renderInlineCode(content)}</li>`,
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
              sourceLine: lineIndex,
            });
          } else {
            listItems.push({
              kind: "html",
              html: `<li class="md-li" value="${value}"${sourceLineAttrs(lineIndex)}${previewIndentStyle(indentLevel)}>${renderInlineCode(content)}</li>`,
            });
          }

          continue;
        }
      }
    }

    // normal text
    if (listMode) closeList();
    pushTextLine(line, lineIndex);
  }

    // EOF: fence が閉じられていない場合も一応表示
    if (inFence) {
        inFence = false;
        flushFence(lines.length - 1);
    }

    closeList();
    flushText();

    return `<div class="md-preview">${parts.join("\n")}</div>`;
}

