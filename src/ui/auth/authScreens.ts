import {
  beginSignUp,
  changePasswordWithCurrentPassword,
  completeProfileAfterOtp,
  deleteAccountEmail,
  getCurrentLoginEmail,
  getSession,
  listAccountEmails,
  promoteAccountEmailToLogin,
  requestPasswordResetEmail,
  resendSignUpOtp,
  sendLoginEmailChangeOtp,
  sendVerifyAccountEmailOtp,
  signIn,
  signOut,
  startLogin2fa,
  updateLocaleSettings,
  verifyAccountEmailOtp,
  verifyEmailOtp,
  verifyLogin2fa,
  type AccountEmail,
  type PendingSignUpDraft,
} from "../../repos/authRepo";
import { supabase } from "../../lib/supabaseClient";
import { trackEvent } from "../../repos/analyticsRepo";
import {
  formatAdminAnalyticsError,
  getAdminAnalyticsSummary,
  isAdminAnalyticsAvailable,
  type AdminAnalyticsEventName,
  type AdminAnalyticsSummary,
  type AdminAnalyticsWindow,
} from "../../repos/adminAnalyticsRepo";
import { applyI18nProfile, getI18nState, t } from "../../i18n/i18n";
import {
  normalizeLocalePreference,
  normalizeResolvedLocale,
  resolveLocalePreference,
} from "../../i18n/language";
import { qs } from "../../utils/dom";
  
  import mountAuthUIHtml from "../../templates/mountAuthUI.html?raw";
  import signupUIHtml from "../../templates/signupUI.html?raw";
  import signupOtpUIHtml from "../../templates/signupOtpUI.html?raw";
  import resetPasswordUIHtml from "../../templates/resetPasswordUI.html?raw";
  import termsJaHtml from "../../templates/terms.ja.html?raw";
  import termsEnHtml from "../../templates/terms.en.html?raw";
  import privacyJaHtml from "../../templates/privacy.ja.html?raw";
  import privacyEnHtml from "../../templates/privacy.en.html?raw";
  import forgotPasswordUIHtml from "../../templates/forgotPasswordUI.html?raw";
  import accountSettingsUIHtml from "../../templates/accountSettingsUI.html?raw";
  import adminAnalyticsUIHtml from "../../templates/adminAnalyticsUI.html?raw";
  
  type Rerender = (message?: string) => Promise<void>;
  
  let rerenderImpl: Rerender | null = null;
  let resetScreenHandlersImpl: (() => void) | null = null;
  
  export function configureAuthScreens(deps: {
    rerender: Rerender;
    resetScreenHandlers: () => void;
  }) {
    rerenderImpl = deps.rerender;
    resetScreenHandlersImpl = deps.resetScreenHandlers;
  }
  
  function rerender(message = "") {
    if (!rerenderImpl) throw new Error("auth screens are not configured: rerender");
    return rerenderImpl(message);
  }
  
  function resetScreenHandlers() {
    if (!resetScreenHandlersImpl) {
      throw new Error("auth screens are not configured: resetScreenHandlers");
    }
  
    resetScreenHandlersImpl();
  }
  
  const PASSWORD_POLICY = {
    minLength: 8,
    requireLowercase: true,
    requireUppercase: true,
    requireDigit: true,
  };
  
  function setText(selector: string, text: string) {
    const el = qs<HTMLElement>(selector);
    el.textContent = text;
  }
  
  function setMultilineText(selector: string, text: string) {
    const el = qs<HTMLElement>(selector);
    el.textContent = text;
    el.style.whiteSpace = "pre-line";
  }

  function formatI18n(template: string, replacements: Record<string, string>) {
    return Object.entries(replacements).reduce(
      (text, [key, value]) => text.replaceAll(`{${key}}`, value),
      template
    );
  }

  function keyConfirmAccount(
    message: string,
    hintText = t("confirmHintProceedCancel")
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const previousActive = document.activeElement;
      const overlay = document.createElement("div");
      overlay.className = "key-confirm-overlay";

      const card = document.createElement("div");
      card.className = "key-confirm";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.tabIndex = -1;

      const title = document.createElement("div");
      title.className = "key-confirm-title";
      title.textContent = t("confirmTitle");

      const body = document.createElement("div");
      body.className = "key-confirm-body";
      body.textContent = message;

      const hint = document.createElement("div");
      hint.className = "key-confirm-hint";
      hint.textContent = hintText;

      card.append(title, body, hint);
      overlay.append(card);
      document.body.append(overlay);
      card.focus({ preventScroll: true });

      const cleanup = () => {
        window.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        if (previousActive instanceof HTMLElement) {
          previousActive.focus({ preventScroll: true });
        }
      };

      const finish = (result: boolean) => {
        cleanup();
        resolve(result);
      };

      function onKeyDown(event: KeyboardEvent) {
        if (event.isComposing) return;
        const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
        if (key !== "y" && key !== "n" && key !== "escape") return;

        event.preventDefault();
        event.stopPropagation();
        finish(key === "y");
      }

      window.addEventListener("keydown", onKeyDown, true);

      overlay.addEventListener("click", (event) => {
        if (event.target !== overlay) return;
        finish(false);
      });
    });
  }

  function buildPasswordResetRedirectTo() {
    const url = new URL(window.location.href);
    const { resolvedLocale } = getI18nState();
  
    url.searchParams.set("auth", "reset-password");
    url.searchParams.set("lang", resolvedLocale);
    url.hash = "";
  
    return url.toString();
  }
  
  function getTermsHtml() {
    return getI18nState().resolvedLocale === "ja" ? termsJaHtml : termsEnHtml;
  }
  
  function getPrivacyHtml() {
    return getI18nState().resolvedLocale === "ja" ? privacyJaHtml : privacyEnHtml;
  }
  
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
  
    return errors;
  }
  
  function formatAuthErrorMessage(error: unknown): string {
    const raw =
      typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : String(error ?? "");

    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";

    const name =
      typeof error === "object" && error && "name" in error
        ? String((error as { name?: unknown }).name ?? "")
        : "";

    const normalized = raw.trim().toLowerCase();
    const normalizedCode = code.trim().toLowerCase();
    const normalizedName = name.trim().toLowerCase();
    const haystack = `${normalizedCode} ${normalizedName} ${normalized}`;

    if (haystack.includes("failed to send a request to the edge function")) {
      return t("msgAuthNetworkFailed");
    }

    if (
      haystack.includes("edge function returned a non-2xx status code") ||
      haystack.includes("function returned an error") ||
      haystack.includes("functionshttperror")
    ) {
      return t("msgSignupProcedureFailed");
    }

    if (
      haystack.includes("email_rate_limit_exceeded") ||
      haystack.includes("email rate limit exceeded")
    ) {
      return t("msgAuthEmailRateLimitExceeded");
    }

    if (
      haystack.includes("too_many_requests") ||
      haystack.includes("rate limit") ||
      haystack.includes("for security purposes") ||
      haystack.includes("you can only request this after")
    ) {
      return t("msgAuthTooManyRequests");
    }

    if (
      haystack.includes("invalid_credentials") ||
      haystack.includes("invalid login credentials")
    ) {
      return t("msgAuthInvalidLoginCredentials");
    }

    if (
      haystack.includes("email_not_confirmed") ||
      haystack.includes("email not confirmed")
    ) {
      return t("msgAuthEmailNotConfirmed");
    }

    if (
      haystack.includes("otp_expired") ||
      haystack.includes("token has expired") ||
      haystack.includes("token is expired") ||
      haystack.includes("token expired") ||
      haystack.includes("invalid token") ||
      haystack.includes("invalid otp")
    ) {
      return t("msgAuthOtpExpired");
    }

    if (
      haystack.includes("session_not_found") ||
      haystack.includes("auth session missing") ||
      haystack.includes("session missing")
    ) {
      return t("msgAuthSessionMissing");
    }

    if (
      haystack.includes("user_already_exists") ||
      haystack.includes("user already registered") ||
      haystack.includes("user already exists") ||
      haystack.includes("already registered")
    ) {
      return t("msgAuthUserAlreadyExists");
    }

    if (
      haystack.includes("same password") ||
      haystack.includes("different from the old password")
    ) {
      return t("msgAuthPasswordSameAsOld");
    }

    if (
      haystack.includes("weak_password") ||
      haystack.includes("password should be") ||
      haystack.includes("password must be") ||
      haystack.includes("password is too weak")
    ) {
      return t("msgAuthWeakPassword");
    }

    if (
      haystack.includes("invalid email") ||
      haystack.includes("email address is invalid") ||
      haystack.includes("unable to validate email address")
    ) {
      return t("msgAuthInvalidEmail");
    }

    return raw || t("msgAuthFailed");
  }
  
  function formatEmailProcedureErrorMessage(error: unknown): string {
    const raw =
      typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : String(error ?? "");
  
    const normalized = raw.trim().toLowerCase();
  
    if (
      normalized.includes("failed to send a request to the edge function") ||
      normalized.includes("edge function returned a non-2xx status code") ||
      normalized.includes("function returned an error") ||
      normalized.includes("functionshttperror")
    ) {
      return t("msgEmailProcedureConfigFailed");
    }
  
    return formatAuthErrorMessage(error) || t("msgEmailSendFailed");
  }

  function normalizeEmailForCompare(email: string) {
    return email.trim().toLowerCase();
  }

  const TERMS_VERSION = "v1";
  const PRIVACY_VERSION = "v1";
  const PENDING_SIGNUP_STORAGE_KEY = "typingnote.pending-signup";
  const PENDING_SIGNUP_EMAIL_STORAGE_KEY = "typingnote.pending-signup-email";
  
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
  | "login2fa"
  | "forgotPassword"
  | "terms"
  | "privacy"
  | "accountSettings"
  | "adminAnalytics" = "memo";
  
  let legalBackScreen:
  | "memo"
  | "auth"
  | "signup"
  | "signupOtp"
  | "login2fa"
  | "forgotPassword" = "memo";
  
  let authFlashKind: "info" | "error" = "error";
  
  let suppressSignedInRerender = false;

  let pendingAccountEmailVerification:
  | {
      accountEmailId: string;
      maskedEmail: string;
    }
  | null = null;

  let pendingLoginEmailChange:
  | {
      accountEmailId: string;
      maskedEmail: string;
    }
  | null = null;

let pendingLogin2faVerification:
  | {
      accountEmailId: string;
      maskedEmail: string;
      browserSecret: string;
    }
  | null = null;

const LOGIN_2FA_BROWSER_SECRET_STORAGE_KEY =
  "typingnote.login-2fa-browser-secret";

  function getOrCreateLogin2faBrowserSecret() {
    const next = crypto.randomUUID();
  
    if (!canUseLocalStorage()) {
      return next;
    }
  
    const existing = localStorage.getItem(LOGIN_2FA_BROWSER_SECRET_STORAGE_KEY);
    if (existing) return existing;
  
    localStorage.setItem(LOGIN_2FA_BROWSER_SECRET_STORAGE_KEY, next);
    return next;
  }
  
  export function openAccountScreen(
    intent: "signin" | "signup",
    message = "",
    kind: "info" | "error" = "error"
  ) {
    authFlashKind = kind;
    appScreen = intent === "signup" ? "signup" : "auth";
    rerender(message).catch(console.error);
  }
  
  export function openAccountSettingsScreen(
    message = "",
    kind: "info" | "error" = "info"
  ) {
    authFlashKind = kind;
    appScreen = "accountSettings";
    rerender(message).catch(console.error);
  }

  export function openAdminAnalyticsScreen(
    message = "",
    kind: "info" | "error" = "info"
  ) {
    authFlashKind = kind;
    appScreen = "adminAnalytics";
    rerender(message).catch(console.error);
  }

  export function openMemoScreen(message = "") {
    appScreen = "memo";
    rerender(message).catch(console.error);
  }
  
  export function openForgotPasswordScreen(    message = "",
    kind: "info" | "error" = "error"
  ) {
    authFlashKind = kind;
    appScreen = "forgotPassword";
    rerender(message).catch(console.error);
  }
  
  export function openSignupOtpScreen(message = "", kind: "info" | "error" = "info") {
    authFlashKind = kind;
    appScreen = "signupOtp";
    rerender(message).catch(console.error);
  }

  export async function requireLogin2faIfNeeded(): Promise<boolean> {
    if (pendingLogin2faVerification) {
      appScreen = "login2fa";
      await rerender();
      return true;
    }
  
    const browserSecret = getOrCreateLogin2faBrowserSecret();
    const { resolvedLocale } = getI18nState();
  
    const result = await startLogin2fa({
      browserSecret,
      resolvedLocale,
    });
  
    if (!result.required) {
      return false;
    }
  
    pendingLogin2faVerification = {
      accountEmailId: result.accountEmailId,
      maskedEmail: result.maskedEmail,
      browserSecret,
    };
  
    appScreen = "login2fa";
    authFlashKind = "info";
  
    await rerender(result.message ?? "ログイン確認コードを送信しました。");
  
    return true;
  }

  export function openLegalScreen(
    kind: "terms" | "privacy",
    backTo: "memo" | "auth" | "signup" | "signupOtp" | "login2fa"
  ) {
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
  
  
  function savePendingSignUpEmail(email: string) {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(PENDING_SIGNUP_EMAIL_STORAGE_KEY, email.trim().toLowerCase());
  }
  
  function loadPendingSignUpEmail(): string {
    if (!canUseLocalStorage()) return "";
    return localStorage.getItem(PENDING_SIGNUP_EMAIL_STORAGE_KEY) ?? "";
  }
  
  function clearPendingSignUpEmail() {
    if (!canUseLocalStorage()) return;
    localStorage.removeItem(PENDING_SIGNUP_EMAIL_STORAGE_KEY);
  }
  
  function clearPendingSignUpState() {
    clearPendingSignUpDraft();
    clearPendingSignUpEmail();
  }
  
  function savePendingSignUpDraft(draft: PendingSignUpDraft) {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(PENDING_SIGNUP_STORAGE_KEY, JSON.stringify({
      ...draft,
      email: draft.email.trim().toLowerCase(),
    }));
    savePendingSignUpEmail(draft.email);
  }
  
  function loadPendingSignUpDraft(): PendingSignUpDraft | null {
    if (!canUseLocalStorage()) return null;
  
    const raw = localStorage.getItem(PENDING_SIGNUP_STORAGE_KEY);
    if (!raw) return null;
  
    try {
      const parsed = JSON.parse(raw) as Partial<PendingSignUpDraft>;
      if (!parsed || typeof parsed.email !== "string") return null;
  
      const i18n = getI18nState();
  
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
        localePreference:
          normalizeLocalePreference(parsed.localePreference) ?? i18n.localePreference,
        resolvedLocale:
          normalizeResolvedLocale(parsed.resolvedLocale) ?? i18n.resolvedLocale,
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
  
  export function mountSignUpUI(app: HTMLDivElement, message = "") {
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
    
    setText(".auth-title", t("signupTitle"));
    setText("#signupHelp", t("signupHelp"));
    displayNameEl.placeholder = t("requiredPlaceholder");
    familyNameEl.placeholder = t("optionalPlaceholder");
    givenNameEl.placeholder = t("optionalPlaceholder");
    emailEl.placeholder = t("requiredPlaceholder");
    passEl.placeholder = t("requiredPlaceholder");
    pass2El.placeholder = t("requiredPlaceholder");
    setText("#signupPasswordNote", t("passwordPolicyNote"));
    openTermsBtn.textContent = t("terms");
    openPrivacyBtn.textContent = t("privacy");
    setText("#agreeTermsText", t("agreeToTermsSuffix"));
    setText("#agreePrivacyText", t("agreeToPrivacySuffix"));
    submitBtn.textContent = t("proceedToEmailVerification");
    backBtn.textContent = t("backToSignIn");
    topBtn.textContent = t("backToTypingNote");
    
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

      const displayName = buildDisplayName(
        displayNameEl.value,
        familyNameEl.value,
        givenNameEl.value
      );
      const familyName = familyNameEl.value.trim();
      const givenName = givenNameEl.value.trim();
      const email = emailEl.value.trim();
      const password = passEl.value;
      const password2 = pass2El.value;

      if (!displayName) {
        setMsg(t("msgDisplayNameRequired"), "error");
        return;
      }

      if (!email) {
        setMsg(t("msgEmailRequired"), "error");
        return;
      }

      if (!password) {
        setMsg(t("msgPasswordRequired"), "error");
        return;
      }

      if (password !== password2) {
        setMsg(t("msgPasswordConfirmMismatch"), "error");
        return;
      }

      const passwordErrors = validatePassword(password);
      if (passwordErrors.length > 0) {
        setMsg(
          `${t("msgPasswordPolicyNotMetPrefix")}${passwordErrors.join("、")}`,
          "error"
        );
        return;
      }

      if (!agreeTermsEl.checked || !agreePrivacyEl.checked) {
        setMsg(t("msgTermsPrivacyRequired"), "error");
        return;
      }

      const agreedAt = new Date().toISOString();
      const i18n = getI18nState();

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
        localePreference: i18n.localePreference,
        resolvedLocale: i18n.resolvedLocale,
      };

      try {
        setBusy(true);
        setMsg(t("msgSendingEmail"), "info");

        const result = await beginSignUp(nextDraft);

        if (result.status === "error") {
          setMsg(t("msgEmailSendFailed"), "error");
          return;
        }

        savePendingSignUpDraft(nextDraft);
        openSignupOtpScreen(t("msgSignupEmailCheck"), "info");
        return;
      } catch (err: any) {
        console.error(err);
        setMsg(formatEmailProcedureErrorMessage(err), "error");
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
  
  export function mountSignUpOtpUI(app: HTMLDivElement, message = "") {
    resetScreenHandlers();
    app.innerHTML = signupOtpUIHtml;
  
    const msgEl = qs<HTMLDivElement>("#signupOtpMsg");
    const helpEl = qs<HTMLDivElement>("#signupOtpHelp");
    const form = qs<HTMLFormElement>("#signupOtpForm");
    const emailEl = qs<HTMLInputElement>("#signupOtpEmail");
    // const codeLabelEl = qs<HTMLLabelElement>("#signupOtpCodeLabel");
    const codeEl = qs<HTMLInputElement>("#signupOtpCode");
    // const otpActionsEl = qs<HTMLDivElement>("#signupOtpActions");
    const verifyBtn = qs<HTMLButtonElement>("#signupOtpVerifyBtn");
    const resendBtn = qs<HTMLButtonElement>("#signupOtpResendBtn");
    const backBtn = qs<HTMLButtonElement>("#signupOtpBackBtn");
    const topBtn = qs<HTMLButtonElement>("#signupOtpTopBtn");
    
    setMultilineText("#signupOtpHelp", t("signupOtpHelp"));
    verifyBtn.textContent = t("verifyAndCreateAccount");
    resendBtn.textContent = t("resendCode");
    backBtn.textContent = t("backToSignupInput");
    topBtn.textContent = t("backToTypingNote");
    
    const draft = loadPendingSignUpDraft();
    const pendingEmail = draft?.email ?? loadPendingSignUpEmail();
  
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
  
    if (!pendingEmail) {
      emailEl.value = "";
      helpEl.textContent = t("msgSignupInputFirst");
      verifyBtn.disabled = true;
      resendBtn.disabled = true;
      setMsg(t("msgSignupDraftMissing"), "error");
    } else {
      emailEl.value = pendingEmail;
      helpEl.textContent = t("msgSignupEmailCheckHelp");
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
        setMsg(t("msgOtpCodeRequired"), "error");
        return;
      }
  
      try {
        setBusy(true);
        setMsg(t("msgVerifying"), "info");
        suppressSignedInRerender = true;
        await verifyEmailOtp(draft.email, code);
        await completeProfileAfterOtp(draft);
        
        applyI18nProfile({
          locale_preference: draft.localePreference,
          resolved_locale: draft.resolvedLocale,
        });
        
        clearPendingSignUpState();
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
        setMsg(t("msgResendingEmail"), "info");
  
        const result = await resendSignUpOtp(draft);
        if (result.status === "error") {
          setMsg(t("msgEmailSendFailed"), "error");
          return;
        }
  
        setMsg(t("msgEmailProcedureCheck"), "info");
      } catch (err: any) {
        console.error(err);
        setMsg(formatEmailProcedureErrorMessage(err), "error");
      } finally {
        setBusy(false);
      }
    });
  
    backBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (busy) return;
  
      clearPendingSignUpState();
      openAccountScreen("signup");
    });
  
    topBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (busy) return;
  
      clearPendingSignUpState();
      appScreen = "memo";
      await rerender();
    });
  }

  export function mountLogin2faUI(app: HTMLDivElement, message = "") {
    resetScreenHandlers();
  
    const maskedEmail =
      pendingLogin2faVerification?.maskedEmail ?? t("login2faSecurityEmailFallback");
  
    app.innerHTML = `
      <div class="layout auth-layout">
        <form id="login2faForm" class="auth-card" autocomplete="off">
          <div class="auth-title">${t("login2faTitle")}</div>
  
          <div class="auth-help" style="white-space: pre-line;">${formatI18n(t("login2faHelp"), {
            email: maskedEmail,
          })}</div>
  
          <div id="login2faMsg" class="auth-msg" hidden></div>
  
          <label class="auth-label" for="login2faOtpInput">${t("accountVerificationCodeLabel")}</label>
          <input
            id="login2faOtpInput"
            class="auth-input auth-otp-input"
            type="text"
            inputmode="numeric"
            maxlength="6"
            autocomplete="one-time-code"
            placeholder="000000"
          />
  
          <div class="auth-actions auth-actions-stack-mobile">
            <button id="login2faVerifyBtn" class="auth-btn auth-btn-primary" type="submit">
              ${t("login2faVerify")}
            </button>
            <button id="login2faCancelBtn" class="auth-btn auth-btn-secondary" type="button">
              ${t("login2faLogout")}
            </button>
          </div>
        </form>
      </div>
    `;
  
    const form = qs<HTMLFormElement>("#login2faForm");
    const msgEl = qs<HTMLDivElement>("#login2faMsg");
    const otpInput = qs<HTMLInputElement>("#login2faOtpInput");
    const verifyBtn = qs<HTMLButtonElement>("#login2faVerifyBtn");
    const cancelBtn = qs<HTMLButtonElement>("#login2faCancelBtn");
  
    const setMsg = (text: string, kind: "info" | "error" = "error") => {
      if (!text) {
        msgEl.hidden = true;
        msgEl.textContent = "";
        return;
      }
  
      msgEl.hidden = false;
      msgEl.textContent = text;
      msgEl.style.color = kind === "error" ? "#b00020" : "#0b6b2e";
    };
  
    if (message) setMsg(message, authFlashKind);
    else setMsg("");
  
    let busy = false;
    const setBusy = (value: boolean) => {
      busy = value;
      verifyBtn.disabled = value;
      cancelBtn.disabled = value;
      otpInput.disabled = value;
    };
  
    otpInput.addEventListener("input", () => {
      otpInput.value = otpInput.value.replace(/\D+/g, "").slice(0, 6);
    });
  
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
  
      if (!pendingLogin2faVerification) {
        setMsg(t("msgLogin2faMissing"), "error");
        return;
      }
  
      const otp = otpInput.value.trim();
  
      if (!/^\d{6}$/.test(otp)) {
        setMsg(t("accountCodeMustBeSixDigits"), "error");
        return;
      }
  
      try {
        setBusy(true);
        setMsg(t("accountVerifyingCode"), "info");
  
        await verifyLogin2fa({
          accountEmailId: pendingLogin2faVerification.accountEmailId,
          otp,
          browserSecret: pendingLogin2faVerification.browserSecret,
        });
  
        pendingLogin2faVerification = null;
        suppressSignedInRerender = false;
        appScreen = "memo";
        await rerender();
      } catch (error) {
        console.error(error);
        setMsg(formatEmailProcedureErrorMessage(error), "error");
      } finally {
        setBusy(false);
      }
    });
  
    cancelBtn.addEventListener("click", async () => {
      if (busy) return;
  
      pendingLogin2faVerification = null;
      suppressSignedInRerender = false;
      await signOut();
      openAccountScreen("signin", t("msgLoggedOut"), "info");
    });
  
    otpInput.focus();
  }
  
  export function mountAuthUI(app: HTMLDivElement, message = "") {
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
    
    setMultilineText("#authHelp", t("authHelp"));
    signupBtn.textContent = t("createAccount");
    forgotBtn.textContent = t("forgotPassword");
    backToTopBtn.textContent = t("backToTypingNote");
    openTermsFromAuthBtn.textContent = t("terms");
    openPrivacyFromAuthBtn.textContent = t("privacy");
    
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
        setMsg(t("msgAuthRequiredEmailPassword"), "error");
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
        setMsg(t("msgSigningIn"), "info");
        suppressSignedInRerender = true;
      
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
          setMsg(t("msgSessionNotEstablished"), "error");
          return;
        }
  
        trackEvent("auth_signin_succeeded", { trigger: "password" });
        clearPasswordResetEmail();
        setMsg("");
        
        suppressSignedInRerender = true;
        
        const needs2fa = await requireLogin2faIfNeeded();
        
        if (needs2fa) {
          return;
        }
        
        suppressSignedInRerender = false;
        appScreen = "memo";
        await rerender();
      } catch (e2: any) {
        suppressSignedInRerender = false;
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
  
  export function mountForgotPasswordUI(app: HTMLDivElement, message = "") {
    resetScreenHandlers();
    app.innerHTML = forgotPasswordUIHtml;
  
    const msgEl = qs<HTMLDivElement>("#forgotPasswordMsg");
    const form = qs<HTMLFormElement>("#forgotPasswordForm");
    const emailEl = qs<HTMLInputElement>("#forgotPasswordEmail");
    const submitBtn = qs<HTMLButtonElement>("#forgotPasswordSubmitBtn");
    const backBtn = qs<HTMLButtonElement>("#forgotPasswordBackBtn");
    const topBtn = qs<HTMLButtonElement>("#forgotPasswordTopBtn");
    
    setText(".auth-title", t("forgotPasswordTitle"));
    setMultilineText(".auth-help", t("forgotPasswordHelp"));
    setText(".auth-label", "Email");
    submitBtn.textContent = t("sendEmail");
    backBtn.textContent = t("backToSignIn");
    topBtn.textContent = t("backToTypingNote");
    
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
        setMsg(t("msgResetEmailRequired"), "error");
        return;
      }
  
      try {
        setBusy(true);
        setMsg(t("msgSendingEmail"), "info");
  
        savePasswordResetEmail(email);

        const redirectTo = buildPasswordResetRedirectTo();
        const { resolvedLocale } = getI18nState();
        
        const result = await requestPasswordResetEmail({
          email,
          redirectTo,
          resolvedLocale,
        });
        
        setMsg(result.message ?? t("msgEmailProcedureCheck"), "info");
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
  
  export function mountTermsUI(app: HTMLDivElement) {
    resetScreenHandlers();
    app.innerHTML = getTermsHtml();
  
    const backBtn = qs<HTMLButtonElement>("#termsBackBtn");
    backBtn.addEventListener("click", async () => {
      appScreen = legalBackScreen;
      await rerender();
    });
  }
  
  export function mountPrivacyUI(app: HTMLDivElement) {
    resetScreenHandlers();
    app.innerHTML = getPrivacyHtml();
  
    const backBtn = qs<HTMLButtonElement>("#privacyBackBtn");
    backBtn.addEventListener("click", async () => {
      appScreen = legalBackScreen;
      await rerender();
    });
  }

  export function mountAccountSettingsUI(app: HTMLDivElement, message = "") {
    resetScreenHandlers();
    app.innerHTML = accountSettingsUIHtml;

    const form = qs<HTMLFormElement>("#accountSettingsForm");
    const msgEl = qs<HTMLDivElement>("#accountSettingsMsg");
    const selectEl = qs<HTMLSelectElement>("#localePreferenceSelect");
    const saveBtn = qs<HTMLButtonElement>("#accountSettingsSaveBtn");
    const adminAnalyticsBtn = qs<HTMLButtonElement>("#adminAnalyticsBtn");
    const backBtn = qs<HTMLButtonElement>("#accountSettingsBackBtn");

    const currentLoginEmailEl = qs<HTMLDivElement>("#currentLoginEmail");
    const accountEmailListEl = qs<HTMLDivElement>("#accountEmailList");
    const addAccountEmailInputMsg = qs<HTMLDivElement>("#accountEmailInputMsg");
    const addAccountEmailInput = qs<HTMLInputElement>("#addAccountEmailInput");
    const sendAccountEmailOtpBtn = qs<HTMLButtonElement>("#sendAccountEmailOtpBtn");
    const accountEmailOtpArea = qs<HTMLDivElement>("#accountEmailOtpArea");
    const accountEmailOtpTarget = qs<HTMLElement>("#accountEmailOtpTarget");
    const accountEmailOtpInput = qs<HTMLInputElement>("#accountEmailOtpInput");
    const verifyAccountEmailOtpBtn = qs<HTMLButtonElement>("#verifyAccountEmailOtpBtn");
    const loginEmailChangeMsg = qs<HTMLDivElement>("#loginEmailChangeMsg");
    const loginEmailChangeOtpArea = qs<HTMLDivElement>("#loginEmailChangeOtpArea");
    const loginEmailChangeOtpTarget = qs<HTMLElement>("#loginEmailChangeOtpTarget");
    const loginEmailChangeOtpInput = qs<HTMLInputElement>("#loginEmailChangeOtpInput");
    const confirmLoginEmailChangeBtn = qs<HTMLButtonElement>("#confirmLoginEmailChangeBtn");
    const passwordChangeMsg = qs<HTMLDivElement>("#passwordChangeMsg");
    const currentPasswordInput = qs<HTMLInputElement>("#currentPasswordInput");
    const newAccountPasswordInput = qs<HTMLInputElement>("#newAccountPasswordInput");
    const newAccountPasswordConfirmInput = qs<HTMLInputElement>("#newAccountPasswordConfirmInput");
    const changePasswordBtn = qs<HTMLButtonElement>("#changePasswordBtn");

    const restoreAccountEmailOtpArea = () => {
      if (!pendingAccountEmailVerification) {
        accountEmailOtpArea.hidden = true;
        accountEmailOtpTarget.textContent = "";
        accountEmailOtpInput.value = "";
        return;
      }
    
      accountEmailOtpArea.hidden = false;
      accountEmailOtpTarget.textContent = pendingAccountEmailVerification.maskedEmail;
    };

    const restoreLoginEmailChangeOtpArea = () => {
      if (!pendingLoginEmailChange) {
        loginEmailChangeOtpArea.hidden = true;
        loginEmailChangeOtpTarget.textContent = "";
        loginEmailChangeOtpInput.value = "";
        return;
      }
    
      loginEmailChangeOtpArea.hidden = false;
      loginEmailChangeOtpTarget.textContent = pendingLoginEmailChange.maskedEmail;
    };

    let currentLoginEmailForCompare = "";

    const clearAccountEmailOtpState = () => {
      pendingAccountEmailVerification = null;
      accountEmailOtpArea.hidden = true;
      accountEmailOtpTarget.textContent = "";
      accountEmailOtpInput.value = "";
    };

    const clearLoginEmailChangeOtpState = () => {
      pendingLoginEmailChange = null;
      loginEmailChangeOtpArea.hidden = true;
      loginEmailChangeOtpTarget.textContent = "";
      loginEmailChangeOtpInput.value = "";
    };

    setText("#accountSettingsTitle", t("accountSettingsTitle"));
    setMultilineText("#accountSettingsHelp", t("accountSettingsHelp"));
    setText("#accountLanguageSectionTitle", t("accountLanguageSectionTitle"));
    setText("#accountLanguageLabel", t("languageLabel"));
    setText("#localeOptionAuto", t("languageAuto"));
    setText("#localeOptionJa", t("languageJa"));
    setText("#localeOptionEn", t("languageEn"));
    setText("#accountLoginEmailTitle", t("accountLoginEmailTitle"));
    setText("#accountLoginEmailNote", t("accountLoginEmailNote"));
    setText("#loginEmailChangeOtpPrefix", t("accountOtpSentPrefix"));
    setText("#loginEmailChangeOtpLabel", t("accountVerificationCodeLabel"));
    confirmLoginEmailChangeBtn.textContent = t("accountChangeLoginEmail");
    setText("#accountSecurityEmailsTitle", t("accountSecurityEmailsTitle"));
    setText("#accountSecurityEmailsNote", t("accountSecurityEmailsNote"));
    setText("#addAccountEmailLabel", t("accountAddSecurityEmail"));
    sendAccountEmailOtpBtn.textContent = t("accountSendVerificationCode");
    setText("#accountEmailOtpPrefix", t("accountOtpSentPrefix"));
    setText("#accountEmailOtpLabel", t("accountVerificationCodeLabel"));
    verifyAccountEmailOtpBtn.textContent = t("accountVerifyEmail");
    setText("#accountPasswordTitle", t("accountPasswordTitle"));
    setText("#accountPasswordNote", t("accountPasswordNote"));
    setText("#currentPasswordLabel", t("accountCurrentPassword"));
    setText("#newAccountPasswordLabel", t("newPassword"));
    setText("#newAccountPasswordConfirmLabel", t("newPasswordConfirm"));
    changePasswordBtn.textContent = t("accountChangePassword");
    saveBtn.textContent = t("saveSettings");
    adminAnalyticsBtn.textContent = t("adminAnalyticsButton");
    backBtn.textContent = t("backToTypingNote");

    const current = getI18nState();
    selectEl.value = current.localePreference;

    const setMsg = (text: string, kind: "info" | "error" = "error") => {
      if (!text) {
        msgEl.hidden = true;
        msgEl.textContent = "";
        return;
      }
    
      msgEl.hidden = false;
      msgEl.textContent = text;
      msgEl.style.color = kind === "error" ? "#b00020" : "#0b6b2e";
    };
    
    const setAccountEmailInputMsg = (
      text: string,
      kind: "info" | "error" = "error"
    ) => {
      if (!text) {
        addAccountEmailInputMsg.hidden = true;
        addAccountEmailInputMsg.textContent = "";
        return;
      }
    
      addAccountEmailInputMsg.hidden = false;
      addAccountEmailInputMsg.textContent = text;
      addAccountEmailInputMsg.style.color = kind === "error" ? "#b00020" : "#0b6b2e";
    };

    const setLoginEmailChangeMsg = (
      text: string,
      kind: "info" | "error" = "error"
    ) => {
      if (!text) {
        loginEmailChangeMsg.hidden = true;
        loginEmailChangeMsg.textContent = "";
        return;
      }
    
      loginEmailChangeMsg.hidden = false;
      loginEmailChangeMsg.textContent = text;
      loginEmailChangeMsg.style.color = kind === "error" ? "#b00020" : "#0b6b2e";
    };

    const setPasswordChangeMsg = (
      text: string,
      kind: "info" | "error" = "error"
    ) => {
      if (!text) {
        passwordChangeMsg.hidden = true;
        passwordChangeMsg.textContent = "";
        return;
      }
    
      passwordChangeMsg.hidden = false;
      passwordChangeMsg.textContent = text;
      passwordChangeMsg.style.color = kind === "error" ? "#b00020" : "#0b6b2e";
    };
     
    const renderAccountEmailList = (emails: AccountEmail[]) => {
      accountEmailListEl.innerHTML = "";

      if (emails.length === 0) {
        const empty = document.createElement("div");
        empty.className = "account-email-empty";
        empty.textContent = t("accountEmailEmpty");
        accountEmailListEl.append(empty);
        return;
      }

      for (const item of emails) {
        const row = document.createElement("div");
        row.className = "account-email-item";

        const main = document.createElement("div");
        main.className = "account-email-main";

        const address = document.createElement("div");
        address.className = "account-email-address";
        address.textContent = item.email;

        const meta = document.createElement("div");
        meta.className = "account-email-meta";

        const verifiedBadge = document.createElement("span");
        verifiedBadge.className = item.is_verified
          ? "account-email-badge account-email-badge-verified"
          : "account-email-badge account-email-badge-pending";
        verifiedBadge.textContent = item.is_verified
          ? t("accountBadgeVerified")
          : t("accountBadgePending");

        const recoveryBadge = document.createElement("span");
        recoveryBadge.className = "account-email-badge";
        recoveryBadge.textContent = item.use_for_recovery
          ? t("accountBadgeRecoveryEnabled")
          : t("accountBadgeRecoveryDisabled");

        const twoFactorBadge = document.createElement("span");
        twoFactorBadge.className = "account-email-badge";
        twoFactorBadge.textContent = item.use_for_2fa
          ? t("accountBadge2faEnabled")
          : t("accountBadge2faDisabled");

        meta.append(verifiedBadge, recoveryBadge, twoFactorBadge);
        main.append(address, meta);

        const actions = document.createElement("div");
        actions.className = "account-email-actions";

        if (item.is_verified) {
          const promoteBtn = document.createElement("button");
          promoteBtn.type = "button";
          promoteBtn.className = "account-email-action-btn";
          promoteBtn.dataset.accountEmailPromoteBtn = "true";
          promoteBtn.dataset.accountEmailId = item.id;
          promoteBtn.dataset.accountEmailLabel = item.email;
          promoteBtn.textContent = t("accountUseAsLogin");
          promoteBtn.setAttribute(
            "aria-label",
            formatI18n(t("accountUseAsLoginAria"), {
              email: item.email,
            })
          );
          actions.append(promoteBtn);
        }
        
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "account-email-delete-btn";
        deleteBtn.dataset.accountEmailDeleteBtn = "true";
        deleteBtn.dataset.accountEmailId = item.id;
        deleteBtn.dataset.accountEmailLabel = item.email;
        deleteBtn.textContent = t("accountDelete");
        deleteBtn.setAttribute(
          "aria-label",
          formatI18n(t("accountDeleteAria"), {
            email: item.email,
          })
        );
        actions.append(deleteBtn);
        
        row.append(main, actions);
        
        accountEmailListEl.append(row);
      }
    };

    accountEmailListEl.addEventListener("click", async (event) => {
      const promoteBtn = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-account-email-promote-btn]"
      );

      if (promoteBtn) {
        if (busy) return;

        const accountEmailId = promoteBtn.dataset.accountEmailId ?? "";
        const accountEmailLabel =
          promoteBtn.dataset.accountEmailLabel ?? t("accountThisEmail");

        if (!accountEmailId) {
          setLoginEmailChangeMsg(t("accountTargetSecurityEmailMissing"), "error");
          return;
        }

        const ok = await keyConfirmAccount(
          formatI18n(t("accountConfirmSendLoginEmailCode"), {
            email: accountEmailLabel,
          })
        );

        if (!ok) return;

        try {
          setBusy(true);
          setLoginEmailChangeMsg(t("accountSendingVerificationCode"), "info");

          const { resolvedLocale } = getI18nState();
          const result = await sendLoginEmailChangeOtp({
            accountEmailId,
            resolvedLocale,
          });

          pendingLoginEmailChange = {
            accountEmailId: result.accountEmailId,
            maskedEmail: accountEmailLabel,
          };

          loginEmailChangeOtpArea.hidden = false;
          loginEmailChangeOtpTarget.textContent = accountEmailLabel;
          loginEmailChangeOtpInput.value = "";
          setLoginEmailChangeMsg(
            result.message ?? t("accountVerificationCodeSent"),
            "info"
          );

          loginEmailChangeOtpArea.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
          loginEmailChangeOtpInput.focus();
        } catch (error) {
          console.error(error);
          setLoginEmailChangeMsg(formatEmailProcedureErrorMessage(error), "error");
        } finally {
          setBusy(false);
        }

        return;
      }

      const deleteBtn = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-account-email-delete-btn]"
      );
    
      if (!deleteBtn || busy) return;
    
      const accountEmailId = deleteBtn.dataset.accountEmailId ?? "";
      const accountEmailLabel =
        deleteBtn.dataset.accountEmailLabel ?? t("accountThisEmail");
    
      if (!accountEmailId) {
        setMsg(t("accountTargetSecurityEmailMissing"), "error");
        return;
      }
    
      const ok = await keyConfirmAccount(
        formatI18n(t("accountDeleteSecurityEmailConfirm"), {
          email: accountEmailLabel,
        }),
        t("confirmHintDeleteCancel")
      );
    
      if (!ok) return;
    
      try {
        setBusy(true);
        setMsg(t("accountDeletingSecurityEmail"), "info");
    
        await deleteAccountEmail(accountEmailId);
    
        if (pendingAccountEmailVerification?.accountEmailId === accountEmailId) {
          clearAccountEmailOtpState();
        }
        if (pendingLoginEmailChange?.accountEmailId === accountEmailId) {
          clearLoginEmailChangeOtpState();
        }
    
        await refreshAccountEmails();
    
        setMsg(t("accountDeletedSecurityEmail"), "info");
      } catch (error) {
        console.error(error);
        setMsg(t("accountDeleteSecurityEmailFailed"), "error");
      } finally {
        setBusy(false);
      }
    });

    const refreshAccountEmails = async () => {
      const [loginEmail, accountEmails] = await Promise.all([
        getCurrentLoginEmail(),
        listAccountEmails(),
      ]);

      currentLoginEmailForCompare = normalizeEmailForCompare(loginEmail);

      currentLoginEmailEl.textContent = loginEmail || t("accountUnknown");

      renderAccountEmailList(accountEmails);
    };

    if (message) setMsg(message, authFlashKind);
    else setMsg("");
    
    restoreAccountEmailOtpArea();
    restoreLoginEmailChangeOtpArea();
    
    void refreshAccountEmails().catch((error) => {
      console.error(error);
      setMsg(t("accountReadingSecurityEmailsFailed"), "error");
    });

    void isAdminAnalyticsAvailable()
      .then((available) => {
        adminAnalyticsBtn.hidden = !available;
      })
      .catch((error) => {
        console.warn("[admin] failed to check admin analytics access", error);
        adminAnalyticsBtn.hidden = true;
      });

    let busy = false;
    const setBusy = (value: boolean) => {
      busy = value;
      selectEl.disabled = value;
      saveBtn.disabled = value;
      adminAnalyticsBtn.disabled = value;
      backBtn.disabled = value;
      addAccountEmailInput.disabled = value;
      sendAccountEmailOtpBtn.disabled = value;
      accountEmailOtpInput.disabled = value;
      verifyAccountEmailOtpBtn.disabled = value;
      loginEmailChangeOtpInput.disabled = value;
      confirmLoginEmailChangeBtn.disabled = value;
      currentPasswordInput.disabled = value;
      newAccountPasswordInput.disabled = value;
      newAccountPasswordConfirmInput.disabled = value;
      changePasswordBtn.disabled = value;
    
      accountEmailListEl
        .querySelectorAll<HTMLButtonElement>(
          "[data-account-email-delete-btn], [data-account-email-promote-btn]"
        )
        .forEach((button) => {
          button.disabled = value;
        });
    };

    sendAccountEmailOtpBtn.addEventListener("click", async () => {
      if (busy) return;

      const email = addAccountEmailInput.value.trim();
      const normalizedEmail = normalizeEmailForCompare(email);

      if (!normalizedEmail) {
        setAccountEmailInputMsg(t("accountSecurityEmailRequired"), "error");
        return;
      }

      try {
        setBusy(true);
        setMsg(t("accountCheckingEmail"), "info");

        if (!currentLoginEmailForCompare) {
          currentLoginEmailForCompare = normalizeEmailForCompare(
            await getCurrentLoginEmail()
          );
        }

        if (
          currentLoginEmailForCompare &&
          normalizedEmail === currentLoginEmailForCompare
        ) {
          clearAccountEmailOtpState();
          setAccountEmailInputMsg(
            t("accountLoginEmailCannotBeSecurityEmail"),
            "error"
          );
          addAccountEmailInput.focus();
          return;
        }

        setMsg(t("accountSendingVerificationCode"), "info");

        const { resolvedLocale } = getI18nState();
        const result = await sendVerifyAccountEmailOtp(email, resolvedLocale);
        
        if (result.status === "already_verified") {
          pendingAccountEmailVerification = null;
          accountEmailOtpArea.hidden = true;
          accountEmailOtpTarget.textContent = "";
          accountEmailOtpInput.value = "";
        
          await refreshAccountEmails();
        
          setAccountEmailInputMsg(
            result.message ?? t("accountEmailAlreadyVerified"),
            "info"
          );
          addAccountEmailInput.focus();
          return;
        }
        
        pendingAccountEmailVerification = {
          accountEmailId: result.accountEmailId,
          maskedEmail: email,
        };
        
        accountEmailOtpArea.hidden = false;
        accountEmailOtpTarget.textContent = email;
        accountEmailOtpInput.value = "";
        
        await refreshAccountEmails();

        setAccountEmailInputMsg(
          result.message ?? t("accountVerificationCodeSent"),
          "info"
        );
        
        accountEmailOtpArea.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
        
        accountEmailOtpInput.focus();
      } catch (error) {
        console.error(error);
        setAccountEmailInputMsg(formatEmailProcedureErrorMessage(error), "error");
      } finally {
        setBusy(false);
      }
    });

    verifyAccountEmailOtpBtn.addEventListener("click", async () => {
      if (busy) return;

      const otp = accountEmailOtpInput.value.trim();

      if (!pendingAccountEmailVerification) {
        setMsg(t("accountSendCodeFirst"), "error");
        return;
      }

      if (!/^\d{6}$/.test(otp)) {
        setMsg(t("accountCodeMustBeSixDigits"), "error");
        return;
      }

      try {
        setBusy(true);
        setMsg(t("accountVerifyingCode"), "info");

        const result = await verifyAccountEmailOtp(
          pendingAccountEmailVerification.accountEmailId,
          otp
        );
        
        pendingAccountEmailVerification = null;
        accountEmailOtpArea.hidden = true;
        accountEmailOtpTarget.textContent = "";
        accountEmailOtpInput.value = "";
        addAccountEmailInput.value = "";

        await refreshAccountEmails();

        setMsg(result.message ?? t("accountEmailVerified"), "info");
      } catch (error) {
        console.error(error);
        setMsg(formatEmailProcedureErrorMessage(error), "error");
      } finally {
        setBusy(false);
      }
    });

    addAccountEmailInput.addEventListener("input", () => {
      setAccountEmailInputMsg("");
    });

    addAccountEmailInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      sendAccountEmailOtpBtn.click();
    });

    accountEmailOtpInput.addEventListener("input", () => {
      accountEmailOtpInput.value = accountEmailOtpInput.value
        .replace(/\D+/g, "")
        .slice(0, 6);
    });

    accountEmailOtpInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      verifyAccountEmailOtpBtn.click();
    });

    loginEmailChangeOtpInput.addEventListener("input", () => {
      loginEmailChangeOtpInput.value = loginEmailChangeOtpInput.value
        .replace(/\D+/g, "")
        .slice(0, 6);
    });

    loginEmailChangeOtpInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      confirmLoginEmailChangeBtn.click();
    });

    confirmLoginEmailChangeBtn.addEventListener("click", async () => {
      if (busy) return;

      const otp = loginEmailChangeOtpInput.value.trim();

      if (!pendingLoginEmailChange) {
        setLoginEmailChangeMsg(t("accountSendCodeFirst"), "error");
        return;
      }

      if (!/^\d{6}$/.test(otp)) {
        setLoginEmailChangeMsg(t("accountCodeMustBeSixDigits"), "error");
        return;
      }

      const ok = await keyConfirmAccount(
        t("accountConfirmChangeLoginEmail")
      );

      if (!ok) return;

      try {
        setBusy(true);
        setLoginEmailChangeMsg(t("accountChangingLoginEmail"), "info");

        const result = await promoteAccountEmailToLogin({
          accountEmailId: pendingLoginEmailChange.accountEmailId,
          otp,
          resolvedLocale: getI18nState().resolvedLocale,
        });

        clearLoginEmailChangeOtpState();
        await refreshAccountEmails();

        setMsg(
          result.message ??
            t("accountLoginEmailChangedOldRetained"),
          "info"
        );
        setLoginEmailChangeMsg("");
      } catch (error) {
        console.error(error);
        setLoginEmailChangeMsg(formatEmailProcedureErrorMessage(error), "error");
      } finally {
        setBusy(false);
      }
    });

    const clearPasswordInputs = () => {
      currentPasswordInput.value = "";
      newAccountPasswordInput.value = "";
      newAccountPasswordConfirmInput.value = "";
    };

    changePasswordBtn.addEventListener("click", async () => {
      if (busy) return;

      const currentPassword = currentPasswordInput.value;
      const newPassword = newAccountPasswordInput.value;
      const newPasswordConfirm = newAccountPasswordConfirmInput.value;

      if (!currentPassword) {
        setPasswordChangeMsg(t("accountCurrentPasswordRequired"), "error");
        return;
      }

      if (!newPassword || !newPasswordConfirm) {
        setPasswordChangeMsg(t("msgNewPasswordRequired"), "error");
        return;
      }

      if (newPassword !== newPasswordConfirm) {
        setPasswordChangeMsg(t("msgNewPasswordConfirmMismatch"), "error");
        return;
      }

      if (currentPassword === newPassword) {
        setPasswordChangeMsg(t("msgAuthPasswordSameAsOld"), "error");
        return;
      }

      const passwordErrors = validatePassword(newPassword);
      if (passwordErrors.length > 0) {
        setPasswordChangeMsg(
          `${t("msgNewPasswordPolicyNotMetPrefix")}: ${passwordErrors.join("、")}`,
          "error"
        );
        return;
      }

      const ok = await keyConfirmAccount(
        t("accountConfirmChangePassword")
      );

      if (!ok) return;

      try {
        setBusy(true);
        setPasswordChangeMsg(t("accountChangingPassword"), "info");

        await changePasswordWithCurrentPassword({
          currentPassword,
          newPassword,
        });

        clearPasswordInputs();
        setPasswordChangeMsg(t("accountPasswordChangedSigningOut"), "info");

        forceSignedOutScreen = "auth";
        authMode = "normal";
        await signOut();
        openAccountScreen("signin", t("msgPasswordUpdatedSignIn"), "info");
      } catch (error) {
        console.error(error);
        setPasswordChangeMsg(formatAuthErrorMessage(error), "error");
      } finally {
        setBusy(false);
      }
    });

    [currentPasswordInput, newAccountPasswordInput, newAccountPasswordConfirmInput].forEach(
      (input) => {
        input.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          changePasswordBtn.click();
        });
      }
    );

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;

      const localePreference =
        normalizeLocalePreference(selectEl.value) ?? "auto";
      const resolvedLocale = resolveLocalePreference(localePreference);

      try {
        setBusy(true);
        setMsg(t("msgSettingsSaving"), "info");

        const saved = await updateLocaleSettings({
          localePreference,
          resolvedLocale,
        });

        applyI18nProfile(saved);

        authFlashKind = "info";
        await rerender(t("msgSettingsSaved"));
      } catch (error) {
        console.error(error);
        setMsg(t("msgSettingsSaveFailed"), "error");
      } finally {
        setBusy(false);
      }
    });

    backBtn.addEventListener("click", async () => {
      if (busy) return;
      appScreen = "memo";
      await rerender();
    });

    adminAnalyticsBtn.addEventListener("click", () => {
      if (busy) return;
      openAdminAnalyticsScreen();
    });
  }

  const ADMIN_EVENT_LABEL_KEYS = {
    memo_saved: "adminEventMemoSaved",
    memo_created: "adminEventMemoCreated",
    memo_updated: "adminEventMemoUpdated",
    explorer_opened: "adminEventExplorerOpened",
    dust_opened: "adminEventDustOpened",
    search_used: "adminEventSearchUsed",
    feedback_sent: "adminEventFeedbackSent",
    auth_signin_succeeded: "adminEventSignInSucceeded",
  } as const;

  const ADMIN_EVENT_ORDER = Object.keys(
    ADMIN_EVENT_LABEL_KEYS
  ) as AdminAnalyticsEventName[];

  function formatAdminCount(value: number | null | undefined) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return t("adminNotAvailable");
    }

    const locale = getI18nState().resolvedLocale === "ja" ? "ja-JP" : "en-US";
    return new Intl.NumberFormat(locale).format(value);
  }

  function formatAdminDateTime(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;

    const locale = getI18nState().resolvedLocale === "ja" ? "ja-JP" : "en-US";
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function getAdminWindowLabel(windowSummary: AdminAnalyticsWindow) {
    if (windowSummary.key === "today") return t("adminToday");
    if (windowSummary.key === "last7d") return t("adminLast7Days");
    if (windowSummary.key === "last30d") return t("adminLast30Days");
    return windowSummary.label;
  }

  function appendAdminMetric(
    parent: HTMLElement,
    label: string,
    value: string,
    detail = ""
  ) {
    const item = document.createElement("div");
    item.className = "admin-analytics-metric";

    const valueEl = document.createElement("div");
    valueEl.className = "admin-analytics-metric-value";
    valueEl.textContent = value;

    const labelEl = document.createElement("div");
    labelEl.className = "admin-analytics-metric-label";
    labelEl.textContent = label;

    item.append(valueEl, labelEl);

    if (detail) {
      const detailEl = document.createElement("div");
      detailEl.className = "admin-analytics-metric-detail";
      detailEl.textContent = detail;
      item.append(detailEl);
    }

    parent.append(item);
  }

  function renderAdminWindow(parent: HTMLElement, windowSummary: AdminAnalyticsWindow) {
    const section = document.createElement("section");
    section.className = "admin-analytics-window";

    const header = document.createElement("div");
    header.className = "admin-analytics-window-header";

    const title = document.createElement("div");
    title.className = "admin-analytics-window-title";
    title.textContent = getAdminWindowLabel(windowSummary);

    const since = document.createElement("div");
    since.className = "admin-analytics-window-since";
    since.textContent = formatI18n(t("adminSince"), {
      date: formatAdminDateTime(windowSummary.since),
    });

    header.append(title, since);

    const metrics = document.createElement("div");
    metrics.className = "admin-analytics-grid admin-analytics-grid-compact";
    appendAdminMetric(
      metrics,
      t("adminMetricEvents"),
      formatAdminCount(windowSummary.totalEvents)
    );
    appendAdminMetric(
      metrics,
      t("adminMetricAnonymousEvents"),
      formatAdminCount(windowSummary.anonymousEvents)
    );
    appendAdminMetric(
      metrics,
      t("adminMetricSignedInEvents"),
      formatAdminCount(windowSummary.authenticatedEvents)
    );
    appendAdminMetric(
      metrics,
      t("adminMetricAnonymousVisitors"),
      formatAdminCount(windowSummary.uniqueAnonymousVisitors)
    );
    appendAdminMetric(
      metrics,
      t("adminMetricSignedInUsers"),
      formatAdminCount(windowSummary.uniqueAuthenticatedUsers)
    );

    const table = document.createElement("table");
    table.className = "admin-analytics-table";

    const tbody = document.createElement("tbody");
    for (const eventName of ADMIN_EVENT_ORDER) {
      const row = document.createElement("tr");

      const nameCell = document.createElement("th");
      nameCell.scope = "row";
      nameCell.textContent = t(ADMIN_EVENT_LABEL_KEYS[eventName]);

      const countCell = document.createElement("td");
      countCell.textContent = formatAdminCount(windowSummary.eventCounts[eventName] ?? 0);

      row.append(nameCell, countCell);
      tbody.append(row);
    }

    table.append(tbody);
    section.append(header, metrics, table);
    parent.append(section);
  }

  function renderAdminSummary(
    totalsEl: HTMLElement,
    windowsEl: HTMLElement,
    noteEl: HTMLElement,
    summary: AdminAnalyticsSummary
  ) {
    totalsEl.innerHTML = "";
    windowsEl.innerHTML = "";

    appendAdminMetric(
      totalsEl,
      t("adminMetricRegisteredUsers"),
      formatAdminCount(summary.totals.registeredUsers)
    );
    appendAdminMetric(
      totalsEl,
      t("adminMetricActiveMemos"),
      formatAdminCount(summary.totals.activeMemos)
    );
    appendAdminMetric(
      totalsEl,
      t("adminMetricDustMemos"),
      formatAdminCount(summary.totals.trashedMemos)
    );
    appendAdminMetric(
      totalsEl,
      t("adminMetricFeedbackLast30Days"),
      formatAdminCount(summary.totals.feedbackSubmissionsLast30d),
      formatI18n(t("adminGenerated"), {
        date: formatAdminDateTime(summary.generatedAt),
      })
    );

    for (const windowSummary of summary.windows) {
      renderAdminWindow(windowsEl, windowSummary);
    }

    noteEl.hidden = !summary.notes.recentEventRowsTruncated;
    noteEl.textContent = summary.notes.recentEventRowsTruncated
      ? formatI18n(t("adminRecentRowsCapped"), {
          count: formatAdminCount(summary.notes.recentEventRowsLimit),
        })
      : "";
  }

  export function mountAdminAnalyticsUI(app: HTMLDivElement, message = "") {
    resetScreenHandlers();
    app.innerHTML = adminAnalyticsUIHtml;

    const msgEl = qs<HTMLDivElement>("#adminAnalyticsMsg");
    const totalsEl = qs<HTMLDivElement>("#adminAnalyticsTotals");
    const windowsEl = qs<HTMLDivElement>("#adminAnalyticsWindows");
    const noteEl = qs<HTMLDivElement>("#adminAnalyticsNote");
    const refreshBtn = qs<HTMLButtonElement>("#adminAnalyticsRefreshBtn");
    const backBtn = qs<HTMLButtonElement>("#adminAnalyticsBackBtn");

    setText("#adminAnalyticsTitle", t("adminAnalytics"));
    setText("#adminAnalyticsHelp", t("adminAnalyticsHelp"));
    setText("#adminAnalyticsTotalsTitle", t("adminTotals"));
    setText("#adminAnalyticsEventsTitle", t("adminEvents"));
    refreshBtn.textContent = t("adminRefresh");
    backBtn.textContent = t("adminBackToAccountSettings");

    let busy = false;

    const setMsg = (text: string, kind: "info" | "error" = "error") => {
      if (!text) {
        msgEl.hidden = true;
        msgEl.textContent = "";
        return;
      }

      msgEl.hidden = false;
      msgEl.textContent = text;
      msgEl.style.color = kind === "error" ? "#b00020" : "#0b6b2e";
    };

    const setBusy = (value: boolean) => {
      busy = value;
      refreshBtn.disabled = value;
      backBtn.disabled = value;
    };

    const loadSummary = async () => {
      try {
        setBusy(true);
        setMsg(t("adminLoading"), "info");

        const summary = await getAdminAnalyticsSummary();
        renderAdminSummary(totalsEl, windowsEl, noteEl, summary);
        setMsg("");
      } catch (error) {
        console.error(error);
        totalsEl.innerHTML = "";
        windowsEl.innerHTML = "";
        noteEl.hidden = true;
        noteEl.textContent = "";
        setMsg(
          getI18nState().resolvedLocale === "ja"
            ? t("adminLoadFailed")
            : formatAdminAnalyticsError(error),
          "error"
        );
      } finally {
        setBusy(false);
      }
    };

    if (message) setMsg(message, authFlashKind);

    refreshBtn.addEventListener("click", () => {
      if (busy) return;
      void loadSummary();
    });

    backBtn.addEventListener("click", async () => {
      if (busy) return;
      appScreen = "accountSettings";
      await rerender();
    });

    void loadSummary();
  }

  export function mountResetPasswordUI(app: HTMLDivElement) {
    resetScreenHandlers();
    app.innerHTML = resetPasswordUIHtml;
  
    const msg = qs<HTMLDivElement>("#resetMsg");
    const p1 = qs<HTMLInputElement>("#newPassword");
    const p2 = qs<HTMLInputElement>("#newPassword2");
    const form = qs<HTMLFormElement>("#resetForm");
    const submitBtn = qs<HTMLButtonElement>("#resetBtn");
    const goSigninBtn = qs<HTMLButtonElement>("#goSigninAfterResetBtn");
    
    setText(".auth-title", t("resetPasswordTitle"));
    setMultilineText(".auth-help", t("resetPasswordHelp"));
    const labels = document.querySelectorAll<HTMLLabelElement>(".auth-label");
    if (labels[0]) labels[0].textContent = t("newPassword");
    if (labels[1]) labels[1].textContent = t("newPasswordConfirm");
    submitBtn.textContent = t("updatePassword");
    goSigninBtn.textContent = t("goToSignIn");
    
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
  
      if (!a || !b) return show(t("msgNewPasswordRequired"));
      if (a !== b) return show(t("msgNewPasswordConfirmMismatch"));
  
      const passwordErrors = validatePassword(a);
      if (passwordErrors.length > 0) {
        return show(`${t("msgNewPasswordPolicyNotMetPrefix")}: ${passwordErrors.join("、")}`);
      }
  
      submitBtn.disabled = true;
      p1.disabled = true;
      p2.disabled = true;
  
      try {
        const { error } = await supabase.auth.updateUser({ password: a });
        if (error) throw error;
  
        completed = true;
        show(t("msgPasswordUpdated"),"info");
  
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
  
      openAccountScreen("signin", t("msgPasswordUpdatedSignIn"), "info");
    });
  }
  
  export function getAuthMode() {
    return authMode;
  }
  
  export function setAuthMode(next: typeof authMode) {
    authMode = next;
  }
  
  export function getAppScreen() {
    return appScreen;
  }
  
  export function setAppScreen(next: typeof appScreen) {
    appScreen = next;
  }
  
  export function shouldSuppressSignedInRerender() {
    return suppressSignedInRerender;
  }
  
  export function consumeForceSignedOutScreen() {
    const next = forceSignedOutScreen;
    forceSignedOutScreen = null;
    return next;
  }
  
