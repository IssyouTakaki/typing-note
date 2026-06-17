import { createClient } from "npm:@supabase/supabase-js@2";

type ResolvedLocale = "ja" | "en";

type RequestBody = {
  email?: string;
  redirectTo?: string;
  resolvedLocale?: ResolvedLocale;
};

type ResetMail = {
  to: string;
  actionLink: string;
  resolvedLocale: ResolvedLocale;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESET_RATE_LIMIT_WINDOW_MINUTES = 15;
const RESET_RATE_LIMIT_COUNT = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeResolvedLocale(value: unknown): ResolvedLocale {
  return value === "ja" || value === "en" ? value : "en";
}

function getServiceRoleKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (rawSecretKeys) {
    try {
      const parsed = JSON.parse(rawSecretKeys) as Record<string, unknown>;
      const firstStringValue = Object.values(parsed).find(
        (value): value is string => typeof value === "string" && value.length > 0
      );

      if (firstStringValue) return firstStringValue;
    } catch {
      // fallback below
    }
  }

  throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS is required");
}

function createAdminClient() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    getServiceRoleKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resolveRedirectTo(value: unknown) {
  const fallback =
    Deno.env.get("PASSWORD_RESET_REDIRECT_TO") ??
    requiredEnv("PASSWORD_RESET_PAGE_URL");

  const allowedOrigins = (
    Deno.env.get("PASSWORD_RESET_ALLOWED_ORIGINS") ??
    new URL(fallback).origin
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  try {
    const url = new URL(String(value || fallback));

    if (!allowedOrigins.includes(url.origin)) {
      return fallback;
    }

    return url.toString();
  } catch {
    return fallback;
  }
}

function buildPasswordResetEmail(args: ResetMail) {
  const actionLink = args.actionLink;
  const escapedActionLink = escapeHtml(actionLink);

  if (args.resolvedLocale === "ja") {
    const subject = "TypingNote パスワード再設定";

    const text = [
      "TypingNote のパスワード再設定手続きです。",
      "",
      "以下のリンクからパスワードを再設定してください。",
      actionLink,
      "",
      "この手続きに心当たりがない場合、このメールは破棄して構いません。",
    ].join("\n");

    const html = `
      <p>TypingNote のパスワード再設定手続きです。</p>
      <p>以下のリンクからパスワードを再設定してください。</p>
      <p><a href="${escapedActionLink}">パスワードを再設定する</a></p>
      <p>この手続きに心当たりがない場合、このメールは破棄して構いません。</p>
    `;

    return { subject, text, html };
  }

  const subject = "Reset your TypingNote password";

  const text = [
    "This is your TypingNote password reset email.",
    "",
    "Use the link below to reset your password.",
    actionLink,
    "",
    "If you did not request this, you can safely ignore this email.",
  ].join("\n");

  const html = `
    <p>This is your TypingNote password reset email.</p>
    <p>Use the link below to reset your password.</p>
    <p><a href="${escapedActionLink}">Reset your password</a></p>
    <p>If you did not request this, you can safely ignore this email.</p>
  `;

  return { subject, text, html };
}

async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = requiredEnv("AUTH_MAIL_FROM");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error: ${res.status} ${body}`);
  }
}

async function isRateLimited(admin: ReturnType<typeof createAdminClient>, email: string) {
  const windowStart = new Date(
    Date.now() - RESET_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  const { count, error } = await admin
    .from("password_reset_requests")
    .select("id", { count: "exact", head: true })
    .eq("normalized_email", email)
    .gte("created_at", windowStart);

  if (error) throw error;

  return (count ?? 0) >= RESET_RATE_LIMIT_COUNT;
}

async function recordResetRequest(
  admin: ReturnType<typeof createAdminClient>,
  email: string
) {
  const { error } = await admin.from("password_reset_requests").insert({
    normalized_email: email,
  });

  if (error) throw error;
}

async function generateRecoveryLink(args: {
  admin: ReturnType<typeof createAdminClient>;
  loginEmail: string;
  redirectTo: string;
}) {
  const { data, error } = await args.admin.auth.admin.generateLink({
    type: "recovery",
    email: args.loginEmail,
    options: {
      redirectTo: args.redirectTo,
    },
  });

  if (error) {
    console.warn("[request-password-reset] recovery link skipped", {
      email: args.loginEmail,
      message: error.message,
    });
    return null;
  }

  const actionLink = (
    data.properties as { action_link?: string } | undefined
  )?.action_link;

  if (!actionLink) {
    console.warn("[request-password-reset] action_link was missing", {
      email: args.loginEmail,
    });
    return null;
  }

  return actionLink;
}

async function findSecurityEmailResetTarget(args: {
  admin: ReturnType<typeof createAdminClient>;
  normalizedEmail: string;
  redirectTo: string;
}) {
  const { data: accountEmail, error: accountEmailError } = await args.admin
    .from("account_emails")
    .select("id,user_id,email,normalized_email,is_verified,use_for_recovery")
    .eq("normalized_email", args.normalizedEmail)
    .eq("is_verified", true)
    .eq("use_for_recovery", true)
    .maybeSingle();

  if (accountEmailError) throw accountEmailError;
  if (!accountEmail) return null;

  const { data: userData, error: userError } =
    await args.admin.auth.admin.getUserById(accountEmail.user_id);

  if (userError || !userData.user?.email) {
    console.warn("[request-password-reset] auth user not found", {
      accountEmailId: accountEmail.id,
      userId: accountEmail.user_id,
      message: userError?.message,
    });
    return null;
  }

  const actionLink = await generateRecoveryLink({
    admin: args.admin,
    loginEmail: userData.user.email,
    redirectTo: args.redirectTo,
  });

  if (!actionLink) return null;

  return {
    to: accountEmail.email,
    actionLink,
  };
}

async function requestPasswordReset(body: RequestBody) {
  const admin = createAdminClient();
  const normalizedEmail = normalizeEmail(String(body.email ?? ""));
  const resolvedLocale = normalizeResolvedLocale(body.resolvedLocale);
  const redirectTo = resolveRedirectTo(body.redirectTo);

  const genericMessage =
    resolvedLocale === "ja"
      ? "入力されたメールアドレス宛に手続きに関するメールを送信しました。メールに記載された案内を確認してください。"
      : "If the email address can be used for password reset, we sent an email with instructions.";

  if (!normalizedEmail) {
    return json({ status: "ok", message: genericMessage });
  }

  if (await isRateLimited(admin, normalizedEmail)) {
    return json({ status: "ok", message: genericMessage });
  }

  await recordResetRequest(admin, normalizedEmail);

  // 1. まず Login email として扱う。
  // 成功した場合は Login email 宛に送って終了。
  const loginActionLink = await generateRecoveryLink({
    admin,
    loginEmail: normalizedEmail,
    redirectTo,
  });

  if (loginActionLink) {
    const message = buildPasswordResetEmail({
      to: normalizedEmail,
      actionLink: loginActionLink,
      resolvedLocale,
    });

    await sendEmail({
      to: normalizedEmail,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    return json({ status: "ok", message: genericMessage });
  }

  // 2. Login email として見つからなければ、Security email として探す。
  const securityTarget = await findSecurityEmailResetTarget({
    admin,
    normalizedEmail,
    redirectTo,
  });

  if (securityTarget) {
    const message = buildPasswordResetEmail({
      to: securityTarget.to,
      actionLink: securityTarget.actionLink,
      resolvedLocale,
    });

    await sendEmail({
      to: securityTarget.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  // 3. 未登録でも同じレスポンスにする。
  return json({ status: "ok", message: genericMessage });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405);
    }

    const body = (await req.json()) as RequestBody;
    return await requestPasswordReset(body);
  } catch (error) {
    console.error("[request-password-reset] failed", error);

    return json(
      {
        status: "ok",
        message:
          "入力されたメールアドレス宛に手続きに関するメールを送信しました。メールに記載された案内を確認してください。",
      },
      200
    );
  }
});