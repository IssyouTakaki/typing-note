export type LocalePreference = "auto" | "ja" | "en";
export type ResolvedLocale = "ja" | "en";

export const LOCALE_PREFERENCE_STORAGE_KEY = "typingnote.locale_preference";

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "auto" || value === "ja" || value === "en";
}

export function isResolvedLocale(value: unknown): value is ResolvedLocale {
  return value === "ja" || value === "en";
}

export function normalizeLocalePreference(value: unknown): LocalePreference | null {
  return isLocalePreference(value) ? value : null;
}

export function normalizeResolvedLocale(value: unknown): ResolvedLocale | null {
  return isResolvedLocale(value) ? value : null;
}

export function detectBrowserLocale(language = navigator.language): ResolvedLocale {
  return language.trim().toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function resolveLocalePreference(
  preference: LocalePreference,
  browserLanguage = navigator.language
): ResolvedLocale {
  if (preference === "ja") return "ja";
  if (preference === "en") return "en";
  return detectBrowserLocale(browserLanguage);
}

export function canUseLocalStorage() {
  try {
    const key = "__typingnote_locale_storage_test__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function loadStoredLocalePreference(): LocalePreference | null {
  if (!canUseLocalStorage()) return null;

  const value = localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY);
  return normalizeLocalePreference(value);
}

export function saveStoredLocalePreference(preference: LocalePreference) {
  if (!canUseLocalStorage()) return;
  localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, preference);
}