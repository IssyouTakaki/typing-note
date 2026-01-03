import "./style.css";

type AppState = {
  text: string;
};

const DEFAULT_TEXT = `# メモ

左に入力すると、右に即反映されます。

- 保存はまだ（後で追加）
- まずは2ペインの土台
`;

const state: AppState = {
  text: DEFAULT_TEXT,
};

function escapeHtml(input: string): string {
  // 右ペインを innerHTML で描画するため、最低限エスケープ
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPreviewText(text: string): string {
  // まずは「プレーンテキストをそのまま表示」。
  // Markdown化したいならここを差し替える（後で簡単にできる）。
  const escaped = escapeHtml(text);
  return `<pre class="preview-pre">${escaped}</pre>`;
}

function mount() {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("#app not found");

  app.innerHTML = `
    <div class="layout">
      <header class="header">
        <div class="title">TypingNote</div>
        <div class="sub">Left: Input / Right: Preview</div>
      </header>

      <main class="panes">
        <section class="pane pane-left">
          <div class="pane-header">Input</div>
          <textarea id="memoInput" class="textarea" spellcheck="false"></textarea>
        </section>

        <section class="pane pane-right">
          <div class="pane-header">Preview</div>
          <div id="memoPreview" class="preview"></div>
        </section>
      </main>
    </div>
  `;

  const input = document.querySelector<HTMLTextAreaElement>("#memoInput");
  const preview = document.querySelector<HTMLDivElement>("#memoPreview");
  if (!input || !preview) throw new Error("elements not found");

  // 初期値
  input.value = state.text;
  preview.innerHTML = renderPreviewText(state.text);

  // 入力→右に反映
  input.addEventListener("input", () => {
    state.text = input.value;
    preview.innerHTML = renderPreviewText(state.text);
  });
}

mount();
