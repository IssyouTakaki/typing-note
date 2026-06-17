import {
    normalizeLocalePreference,
    normalizeResolvedLocale,
    resolveLocalePreference,
    saveStoredLocalePreference,
    type LocalePreference,
    type ResolvedLocale,
  } from "./language";
  import { translate, type I18nKey } from "./messages";
  
  export type I18nState = {
    localePreference: LocalePreference;
    resolvedLocale: ResolvedLocale;
  };
  
  function createInitialI18nState(): I18nState {
    return {
      localePreference: "auto",
      resolvedLocale: resolveLocalePreference("auto"),
    };
  }
  
  let state: I18nState = createInitialI18nState();
  
  export function getI18nState(): I18nState {
    return state;
  }
  
  export function getActiveLocale(): ResolvedLocale {
    return state.resolvedLocale;
  }
  
  export function setI18nState(next: I18nState) {
    state = next;
    saveStoredLocalePreference(next.localePreference);
  }
  
  export function resetI18nToBrowserLocale() {
    setI18nState({
      localePreference: "auto",
      resolvedLocale: resolveLocalePreference("auto"),
    });
  }
  
  export function applyI18nProfile(profile: {
    locale_preference?: unknown;
    resolved_locale?: unknown;
  } | null) {
    const localePreference =
      normalizeLocalePreference(profile?.locale_preference) ??
      "auto";
  
    const profileResolvedLocale = normalizeResolvedLocale(profile?.resolved_locale);
  
    setI18nState({
      localePreference,
      resolvedLocale:
        localePreference === "auto"
          ? resolveLocalePreference("auto")
          : profileResolvedLocale ?? resolveLocalePreference(localePreference),
    });
  }
  
  export function t(key: I18nKey): string {
    return translate(getActiveLocale(), key);
  }
  
  export function applyI18nFromUrlLang(search = window.location.search): boolean {
    const params = new URLSearchParams(search);
    const resolvedLocale = normalizeResolvedLocale(params.get("lang"));
  
    if (!resolvedLocale) return false;
  
    setI18nState({
      localePreference: resolvedLocale,
      resolvedLocale,
    });
  
    return true;
  }
