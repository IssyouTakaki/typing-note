export function isSaveShortcut(e: KeyboardEvent) {
    const keyRow = e.key;
    if (typeof keyRow !== "string") return false;
    const key = keyRow.toLowerCase();
    if (key !== "s") return false;
  
    // 代替案として下記一行を削除する
    const isMac = navigator.platform.toLowerCase().includes("mac");
    return e.altKey && (isMac ? e.metaKey : e.ctrlKey);
  }
  
  export function isExplorerSortShortcut(e: KeyboardEvent) {
    const keyRow = e.key;
    if (typeof keyRow !== "string") return false;
    if (keyRow.toLowerCase() !== "o") return false;
  
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const hasMod = isMac ? e.metaKey : e.ctrlKey;
  
    return e.altKey && e.shiftKey && hasMod;
  }
  
  export function isListSelectToggleShortcut(e: KeyboardEvent) {
    const keyRow = e.key;
    if (typeof keyRow !== "string") return false;
    // Space can be reported as " " or "Space"
    const isSpace = keyRow === " " || keyRow === "Space" || e.code === "Space";
    if (!isSpace) return false;
  
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const hasMod = isMac ? e.metaKey : e.ctrlKey;
    return e.altKey && e.shiftKey && hasMod;
  }
  
  export function isNewShortcut(e:KeyboardEvent) {
    const keyRow = e.key;
    if (typeof keyRow !== "string") return false;
    if (keyRow.toLowerCase() !== "t") return false;
  
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const hasMod = isMac ? e.metaKey : e.ctrlKey;
  
    return e.altKey && hasMod && e.shiftKey;  
  }
  
  export function isDeleteShortcut(e: KeyboardEvent) {
    const keyRow = e.key;
    if (typeof keyRow !== "string") return false;
    if (keyRow.toLowerCase() !== "d") return false;
  
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const hasMod = isMac ? e.metaKey : e.ctrlKey;
    return e.altKey && e.shiftKey && hasMod;
  }
  
  export function isCloseShortcut(e: KeyboardEvent) {
    const keyRow = e.key;
    if (typeof keyRow !== "string") return false;
    if (keyRow.toLowerCase() !== "w") return false;
  
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const hasMod = isMac ? e.metaKey : e.ctrlKey;
    return e.altKey && e.shiftKey && hasMod;
  }
  
  export function getRelativeTabShortcutDelta(e: KeyboardEvent): -1 | 1 | null {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const hasMod = isMac ? e.metaKey : e.ctrlKey;
  
    if (!e.altKey || !e.shiftKey || !hasMod) return null;
  
    const key = typeof e.key === "string" ? e.key : "";
  
    // Shift 押下中は US 配列などで "{" / "}" として来ることがあるため code も見る
    if (e.code === "BracketLeft" || key === "[" || key === "{") return -1;
    if (e.code === "BracketRight" || key === "]" || key === "}") return 1;
  
    return null;
  }
  
  export function isTogglePreviewWideShortcut(e: KeyboardEvent) {
    const keyRow = e.key;
    if (typeof keyRow !== "string") return false;
    if (keyRow.toLowerCase() !== "v") return false;
  
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const hasMod = isMac ? e.metaKey : e.ctrlKey;
  
    return e.altKey && e.shiftKey && hasMod;
  }
  
  export function isToggleEditWideShortcut(e: KeyboardEvent) {
    const keyRow = e.key;
    if (typeof keyRow !== "string") return false;
    if (keyRow.toLowerCase() !== "e") return false;
  
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const hasMod = isMac ? e.metaKey : e.ctrlKey;
  
    return e.altKey && e.shiftKey && hasMod;
  }
  
  export function isSearchShortcut(e: KeyboardEvent) {
    const keyRow = e.key;
    if (typeof keyRow !== "string") return false;
    if (keyRow.toLowerCase() !== "f") return false;
  
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const hasMod = isMac ? e.metaKey : e.ctrlKey;
  
    return e.altKey && e.shiftKey && hasMod;
  }
  
  export function isHeadingPopupShortcut(e: KeyboardEvent) {
    const keyRow = e.key;
    if (typeof keyRow !== "string") return false;
    if (keyRow.toLowerCase() !== "i") return false;
  
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const hasMod = isMac ? e.metaKey : e.ctrlKey;
  
    return e.altKey && e.shiftKey && hasMod;
  }

  export function isAccountSettingsShortcut(e: KeyboardEvent) {
    const keyRow = e.key;
    if (typeof keyRow !== "string") return false;
    if (keyRow.toLowerCase() !== "a") return false;
  
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const hasMod = isMac ? e.metaKey : e.ctrlKey;
  
    return e.altKey && e.shiftKey && hasMod;
  }
  
  export function getShortcutDigit(e: KeyboardEvent): number | null {
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
  
  
