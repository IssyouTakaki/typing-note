import { supabase } from "../lib/supabaseClient";
import { getAnalyticsAnonymousId } from "../repos/analyticsRepo";
import { getProfileLocale } from "../repos/authRepo";
import { configurePostHog } from "../repos/posthogAnalyticsRepo";
import {
  applyI18nProfile,
  resetI18nToBrowserLocale,
} from "../i18n/i18n";
import {
  configureAuthScreens,
  consumeForceSignedOutScreen,
  getAppScreen,
  getAuthMode,
  handleOAuthSignedInSession,
  mountAdminAnalyticsUI,
  mountAuthUI,
  mountAccountSettingsUI,
  mountForgotPasswordUI,
  mountLogin2faUI,
  mountPrivacyUI,
  mountRestoreAccountUI,
  mountResetPasswordUI,
  mountSignUpOtpUI,
  mountSignUpUI,
  mountTermsUI,
  requireLogin2faIfNeeded,
  setAppScreen,
  setAuthMode,
  shouldSuppressSignedInRerender,
} from "../ui/auth/authScreens";
import { mountMemoUI, resetMemoScreenHandlers } from "../ui/memo/mountMemoUI";

async function rerender(message = "") {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("#app not found");

  if (getAuthMode() === "recovery") {
    mountResetPasswordUI(app);
    return;
  }

  if (getAppScreen() === "auth") {
    mountAuthUI(app, message);
    return;
  }

  if (getAppScreen() === "forgotPassword") {
    mountForgotPasswordUI(app, message);
    return;
  }

  if (getAppScreen() === "signup") {
    mountSignUpUI(app, message);
    return;
  }

  if (getAppScreen() === "signupOtp") {
    mountSignUpOtpUI(app, message);
    return;
  }
  
  if (getAppScreen() === "login2fa") {
    mountLogin2faUI(app, message);
    return;
  }
  
  if (getAppScreen() === "terms") {
    mountTermsUI(app);
    return;
  }

  if (getAppScreen() === "privacy") {
    mountPrivacyUI(app);
    return;
  }

  if (getAppScreen() === "accountSettings") {
    mountAccountSettingsUI(app, message);
    return;
  }

  if (getAppScreen() === "restoreAccount") {
    mountRestoreAccountUI(app, message);
    return;
  }

  if (getAppScreen() === "adminAnalytics") {
    mountAdminAnalyticsUI(app, message);
    return;
  }

  mountMemoUI(app, { rerender: () => rerender() });
}

function syncPostHogIdentity(session: any | null) {
  configurePostHog({
    anonymousId: getAnalyticsAnonymousId(),
    userId: session?.user?.id ?? null,
  });
}

async function syncI18nFromSession(sessionOverride?: any) {
  const session =
    sessionOverride === undefined
      ? (await supabase.auth.getSession()).data.session
      : sessionOverride;

  if (!session?.user?.id) {
    resetI18nToBrowserLocale();
    return;
  }

  try {
    const profileLocale = await getProfileLocale(session.user.id);
    applyI18nProfile(profileLocale);
  } catch (error) {
    console.warn("[i18n] failed to load profile locale", error);
    resetI18nToBrowserLocale();
  }
}

function shouldKeepCurrentScreenOnSignedIn() {
  return getAppScreen() === "accountSettings" || getAppScreen() === "adminAnalytics";
}

let signedInSessionHandling = false;

async function handleSignedInSession(session: any) {
  if (signedInSessionHandling) return;
  signedInSessionHandling = true;

  try {
    await syncI18nFromSession(session);
    if (shouldSuppressSignedInRerender()) return;

    const oauthHandled = await handleOAuthSignedInSession(session);
    if (oauthHandled) return;

    if (shouldKeepCurrentScreenOnSignedIn()) {
      return;
    }

    const needs2fa = await requireLogin2faIfNeeded();

    if (needs2fa) {
      return;
    }

    setAppScreen("memo");
    await rerender();
  } finally {
    signedInSessionHandling = false;
  }
}

export async function mountApp() {
  syncPostHogIdentity(null);

  configureAuthScreens({ rerender, resetScreenHandlers: resetMemoScreenHandlers });

  const initialUrl = new URL(window.location.href);
  if (initialUrl.searchParams.get("auth") === "forgot-password") {
    setAppScreen("forgotPassword");
    const cleanUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
    window.history.replaceState(null, "", cleanUrl.toString());
  }

  supabase.auth.onAuthStateChange((event: string, session: any) => {
    console.log("[auth] onAuthStateChange:", event, {
      hasSession: !!session,
      userId: session?.user?.id ?? null,
    });

    syncPostHogIdentity(session);

    if (event === "PASSWORD_RECOVERY") {
      setAuthMode("recovery");
      void (async () => {
        await syncI18nFromSession(session);
        await rerender();
      })().catch(console.error);
      return;
    }

    if (event === "SIGNED_IN") {
      setAuthMode("normal");
      void handleSignedInSession(session).catch(console.error);
      return;
    }

    if (event === "SIGNED_OUT") {
      setAuthMode("normal");
      resetI18nToBrowserLocale();
      setAppScreen(consumeForceSignedOutScreen() ?? "memo");
      rerender().catch(console.error);
      return;
    }
  });

  const initialSession = (await supabase.auth.getSession()).data.session;
  syncPostHogIdentity(initialSession);
  await syncI18nFromSession(initialSession);
  if (initialUrl.searchParams.get("auth") === "oauth" && initialSession) {
    const cleanUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
    window.history.replaceState(null, "", cleanUrl.toString());
    await handleSignedInSession(initialSession);
    return;
  }
  await rerender();
}
