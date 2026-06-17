import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

type LocalePreference = "auto" | "ja" | "en";
type ResolvedLocale = "ja" | "en";

type PendingSignUpDraft = {
  email: string;
  displayName: string;
  familyName: string;
  givenName: string;
  agreedTermsAt: string;
  termsVersion: string;
  agreedPrivacyAt: string;
  privacyVersion: string;
  localePreference?: LocalePreference;
  resolvedLocale?: ResolvedLocale;
};

const ACCEPTED_RESPONSE = {
  status: "accepted",
  message: "入力されたメールアドレス宛にメールを送信しました。メールに記載された案内を確認してください。",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeLocalePreference(value: unknown): LocalePreference {
  return value === "ja" || value === "en" || value === "auto" ? value : "auto";
}

function normalizeResolvedLocale(value: unknown): ResolvedLocale {
  return value === "ja" || value === "en" ? value : "en";
}

function buildUserMetadata(draft: PendingSignUpDraft) {
  const localePreference = normalizeLocalePreference(draft.localePreference);
  const resolvedLocale = normalizeResolvedLocale(draft.resolvedLocale);

  return {
    display_name: draft.displayName,
    family_name: draft.familyName || null,
    given_name: draft.givenName || null,
    agreed_terms_at: draft.agreedTermsAt,
    terms_version: draft.termsVersion,
    agreed_privacy_at: draft.agreedPrivacyAt,
    privacy_version: draft.privacyVersion,
    locale_preference: localePreference,
    resolved_locale: resolvedLocale,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildExistingAccountNotice(
  passwordResetPageUrl: string,
  resolvedLocale: ResolvedLocale
) {
  const safeResetUrl = escapeHtml(passwordResetPageUrl);

  if (resolvedLocale === "ja") {
    const subject = "TypingNote アカウント手続きのご案内";
    const text = [
      "TypingNote のアカウント手続きが行われました。",
      "",
      "このメールアドレスでは、すでにアカウントが作成されています。",
      "アカウント作成用の認証コードは発行されていません。",
      "",
      "パスワードを忘れた場合は、以下のページから再設定メールを送信できます。",
      passwordResetPageUrl,
      "",
      "この手続きに心当たりがない場合、このメールは破棄して構いません。",
    ].join("\n");

    const html = `
      <p>TypingNote のアカウント手続きが行われました。</p>
      <p>このメールアドレスでは、すでにアカウントが作成されています。</p>
      <p>アカウント作成用の認証コードは発行されていません。</p>
      <p>パスワードを忘れた場合は、以下のページから再設定メールを送信できます。</p>
      <p><a href="${safeResetUrl}">${safeResetUrl}</a></p>
      <p>この手続きに心当たりがない場合、このメールは破棄して構いません。</p>
    `;

    return { subject, text, html };
  }

  const subject = "TypingNote account notice";
  const text = [
    "An account procedure was requested for TypingNote.",
    "",
    "An account already exists for this email address.",
    "A verification code for creating a new account was not issued.",
    "",
    "If you forgot your password, you can request a password reset email from the page below.",
    passwordResetPageUrl,
    "",
    "If you did not request this, you can safely ignore this email.",
  ].join("\n");

  const html = `
    <p>An account procedure was requested for TypingNote.</p>
    <p>An account already exists for this email address.</p>
    <p>A verification code for creating a new account was not issued.</p>
    <p>If you forgot your password, you can request a password reset email from the page below.</p>
    <p><a href="${safeResetUrl}">${safeResetUrl}</a></p>
    <p>If you did not request this, you can safely ignore this email.</p>
  `;

  return { subject, text, html };
}

async function sendExistingAccountNotice(
  email: string,
  passwordResetPageUrl: string,
  resolvedLocale: ResolvedLocale
) {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = requiredEnv("AUTH_MAIL_FROM");
  const { subject, text, html } = buildExistingAccountNotice(
    passwordResetPageUrl,
    resolvedLocale
  );

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error: ${res.status} ${body}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405);
    }

    const draft = (await req.json()) as PendingSignUpDraft;
    const email = normalizeEmail(String(draft?.email ?? ""));
    const resolvedLocale = normalizeResolvedLocale(draft?.resolvedLocale);

    if (!email) {
      return json({ error: "email is required" }, 400);
    }

    // 登録済みアカウントへの案内メールを送るため、Resend 設定と再設定ページ URL は全リクエストで必須にする。
    // 登録済みの場合だけ環境変数エラーになると、レスポンス差分でアカウント有無を推測されるため。
    requiredEnv("RESEND_API_KEY");
    requiredEnv("AUTH_MAIL_FROM");
    const passwordResetPageUrl = requiredEnv("PASSWORD_RESET_PAGE_URL");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const publicClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

let page = 1;
const perPage = 200;
let existingUser: any | null = null;
let alreadyRegistered = false;

const isCompletedUser = (user: any) => {
  // TypingNote では「メール確認済み」をアカウント作成完了とみなす。
  // OTP 送信だけで作成された未確認ユーザーは、再度 OTP 送信の対象にする。
  return Boolean(user?.email_confirmed_at && user?.confirmed_at);
};

while (true) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
  if (error) {
    console.error("listUsers failed", error);
    return json(
      {
        status: "error",
        message: "メール送信を完了できませんでした。しばらくしてから再度お試しください。",
      },
      500
    );
  }

  const users = data.users ?? [];
  const matchedUser = users.find(
    (u) => (u.email ?? "").trim().toLowerCase() === email
  );

  if (matchedUser) {
    existingUser = matchedUser;
    alreadyRegistered = isCompletedUser(matchedUser);
  }

  // 見つかった時点で return しない。
  // 早期 return すると応答時間からアカウント有無を推測されやすくなるため。
  if (users.length < perPage) break;
  page += 1;
}

if (alreadyRegistered) {
  try {
    await sendExistingAccountNotice(email, passwordResetPageUrl, resolvedLocale);
  } catch (noticeError) {
    console.error("sendExistingAccountNotice failed", noticeError);
  }

  return json(ACCEPTED_RESPONSE);
}

const userMetadata = buildUserMetadata({ ...draft, email });

if (existingUser && !isCompletedUser(existingUser)) {
  const { error: updateUserError } = await admin.auth.admin.updateUserById(
    existingUser.id,
    { user_metadata: userMetadata }
  );

  if (updateUserError) {
    // user_metadata の更新に失敗しても OTP 再送自体は続行する。
    // OTP 検証後に completeProfileAfterOtp() で最新 draft を再反映するため。
    console.error("update pending signup metadata failed", {
      code: (updateUserError as any)?.code ?? null,
      message: updateUserError.message,
    });
  }
}

const { error: otpError } = await publicClient.auth.signInWithOtp({
  email,
  options: {
    shouldCreateUser: true,
    data: userMetadata,
  },
});

    if (otpError) {
      // 未登録メールだけエラーを返すと、レスポンス差分でアカウント有無を推測される。
      // 送信失敗はログへ出し、クライアントには同一レスポンスを返す。
      console.error("signInWithOtp failed", {
        code: (otpError as any)?.code ?? null,
        message: otpError.message,
      });
    }

    return json(ACCEPTED_RESPONSE);
  } catch (e) {
    console.error("begin-signup failed", e);
    return json(
      {
        status: "error",
        message: "メール送信を完了できませんでした。しばらくしてから再度お試しください。",
      },
      500
    );
  }
});
