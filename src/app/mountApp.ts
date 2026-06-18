import { supabase } from "../lib/supabaseClient";
import { getProfileLocale } from "../repos/authRepo";
import {
  applyI18nProfile,
  resetI18nToBrowserLocale,
} from "../i18n/i18n";
import {
  configureAuthScreens,
  consumeForceSignedOutScreen,
  getAppScreen,
  getAuthMode,
  mountAdminAnalyticsUI,
  mountAuthUI,
  mountAccountSettingsUI,
  mountForgotPasswordUI,
  mountLogin2faUI,
  mountPrivacyUI,
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

  if (getAppScreen() === "adminAnalytics") {
    mountAdminAnalyticsUI(app, message);
    return;
  }

  mountMemoUI(app, { rerender: () => rerender() });
}

async function syncI18nFromSession(sessionOverride?: any) {
  const session =
    sessionOverride ??
    (await supabase.auth.getSession()).data.session;

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

export async function mountApp() {
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
      void (async () => {
        await syncI18nFromSession(session);
        if (shouldSuppressSignedInRerender()) return;

        if (shouldKeepCurrentScreenOnSignedIn()) {
          return;
        }

        const needs2fa = await requireLogin2faIfNeeded();

        if (needs2fa) {
          return;
        }

        setAppScreen("memo");
        await rerender();
      })().catch(console.error);
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

  await syncI18nFromSession();
  await rerender();
}
