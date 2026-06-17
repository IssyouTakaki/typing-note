import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type ResolvedLocale = "ja" | "en";

type AuthHookUser = {
  email?: string;
  new_email?: string;
  user_metadata?: Record<string, unknown>;
};

type AuthHookEmailData = {
  token?: string;
  token_hash?: string;
  redirect_to?: string;
  email_action_type?: string;
  site_url?: string;
  token_new?: string;
  token_hash_new?: string;
};

type AuthHookPayload = {
  user: AuthHookUser;
  email_data: AuthHookEmailData;
};

type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

const RESEND_API_KEY = requiredEnv("RESEND_API_KEY");
const AUTH_MAIL_FROM = requiredEnv("AUTH_MAIL_FROM");
const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SEND_EMAIL_HOOK_SECRET = requiredEnv("SEND_EMAIL_HOOK_SECRET").replace(
  "v1,whsec_",
  "",
);

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeResolvedLocale(value: unknown): ResolvedLocale {
  return value === "ja" || value === "en" ? value : "en";
}

function getUserLocale(user: AuthHookUser): ResolvedLocale {
  return normalizeResolvedLocale(user.user_metadata?.resolved_locale);
}

function getRedirectLocale(redirectTo: string | undefined): ResolvedLocale | null {
  if (!redirectTo) return null;

  try {
    const lang = new URL(redirectTo).searchParams.get("lang");
    return lang === "ja" || lang === "en" ? lang : null;
  } catch {
    return null;
  }
}

function getEmailLocale(user: AuthHookUser, emailData: AuthHookEmailData): ResolvedLocale {
  if (emailData.email_action_type === "recovery") {
    return getRedirectLocale(emailData.redirect_to) ?? getUserLocale(user);
  }

  return getUserLocale(user);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildVerifyUrl(
  tokenHash: string | undefined,
  actionType: string | undefined,
  redirectTo: string | undefined,
) {
  const url = new URL("/auth/v1/verify", SUPABASE_URL);
  url.searchParams.set("token", tokenHash ?? "");
  url.searchParams.set("type", actionType ?? "");
  if (redirectTo) url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}

function buildBaseTemplate(args: {
  title: string;
  intro: string;
  codeLabel?: string;
  token?: string;
  linkLabel?: string;
  linkUrl?: string;
  outro: string;
}) {
  const safeTitle = escapeHtml(args.title);
  const safeIntro = escapeHtml(args.intro);
  const safeOutro = escapeHtml(args.outro);
  const safeToken = escapeHtml(args.token ?? "");
  const safeLinkLabel = escapeHtml(args.linkLabel ?? "");
  const safeLinkUrl = escapeHtml(args.linkUrl ?? "");

  const text = [
    args.title,
    "",
    args.intro,
    args.token && args.codeLabel ? `${args.codeLabel}: ${args.token}` : "",
    args.linkUrl && args.linkLabel ? `${args.linkLabel}: ${args.linkUrl}` : "",
    "",
    args.outro,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #222;">
      <h1 style="font-size: 20px;">${safeTitle}</h1>
      <p>${safeIntro}</p>
      ${
        args.token && args.codeLabel
          ? `<p>${escapeHtml(args.codeLabel)}:</p>
             <p style="font-size: 24px; font-weight: 700; letter-spacing: 0.08em;">${safeToken}</p>`
          : ""
      }
      ${
        args.linkUrl && args.linkLabel
          ? `<p><a href="${safeLinkUrl}" style="display: inline-block; padding: 10px 14px; background: #111; color: #fff; text-decoration: none; border-radius: 8px;">${safeLinkLabel}</a></p>
             <p style="font-size: 12px; color: #666;">${safeLinkUrl}</p>`
          : ""
      }
      <p>${safeOutro}</p>
    </div>
  `;

  return { text, html };
}

function buildAuthEmail(args: {
  to: string;
  locale: ResolvedLocale;
  actionType: string;
  token?: string;
  tokenHash?: string;
  redirectTo?: string;
}) {
  const verifyUrl = buildVerifyUrl(args.tokenHash, args.actionType, args.redirectTo);

  if (args.locale === "ja") {
    if (args.actionType === "recovery") {
      const { text, html } = buildBaseTemplate({
        title: "TypingNote パスワード再設定",
        intro: "以下のボタンからパスワード再設定を続けてください。",
        linkLabel: "パスワードを再設定",
        linkUrl: verifyUrl,
        outro: "この手続きに心当たりがない場合、このメールは破棄して構いません。",
      });

      return {
        to: args.to,
        subject: "TypingNote パスワード再設定",
        text,
        html,
      };
    }

    if (args.actionType === "email_change") {
      const { text, html } = buildBaseTemplate({
        title: "TypingNote メールアドレス変更確認",
        intro: "以下のボタンからメールアドレスの変更を確認してください。",
        linkLabel: "メールアドレス変更を確認",
        linkUrl: verifyUrl,
        outro: "この手続きに心当たりがない場合、このメールは破棄して構いません。",
      });

      return {
        to: args.to,
        subject: "TypingNote メールアドレス変更確認",
        text,
        html,
      };
    }

    const { text, html } = buildBaseTemplate({
      title: "TypingNote 認証コード",
      intro: "TypingNote の手続きに必要な認証コードです。",
      codeLabel: "認証コード",
      token: args.token,
      linkLabel: "メール認証を開く",
      linkUrl: verifyUrl,
      outro: "この手続きに心当たりがない場合、このメールは破棄して構いません。",
    });

    return {
      to: args.to,
      subject: "TypingNote 認証コード",
      text,
      html,
    };
  }

  if (args.actionType === "recovery") {
    const { text, html } = buildBaseTemplate({
      title: "Reset your TypingNote password",
      intro: "Use the button below to continue resetting your password.",
      linkLabel: "Reset password",
      linkUrl: verifyUrl,
      outro: "If you did not request this, you can safely ignore this email.",
    });

    return {
      to: args.to,
      subject: "Reset your TypingNote password",
      text,
      html,
    };
  }

  if (args.actionType === "email_change") {
    const { text, html } = buildBaseTemplate({
      title: "Confirm your TypingNote email change",
      intro: "Use the button below to confirm your email address change.",
      linkLabel: "Confirm email change",
      linkUrl: verifyUrl,
      outro: "If you did not request this, you can safely ignore this email.",
    });

    return {
      to: args.to,
      subject: "Confirm your TypingNote email change",
      text,
      html,
    };
  }

  const { text, html } = buildBaseTemplate({
    title: "TypingNote verification code",
    intro: "Use this verification code to continue with TypingNote.",
    codeLabel: "Verification code",
    token: args.token,
    linkLabel: "Open email verification",
    linkUrl: verifyUrl,
    outro: "If you did not request this, you can safely ignore this email.",
  });

  return {
    to: args.to,
    subject: "TypingNote verification code",
    text,
    html,
  };
}

function buildOutgoingEmails(payload: AuthHookPayload): OutgoingEmail[] {
  const { user, email_data } = payload;
  const actionType = email_data.email_action_type ?? "magiclink";
  const locale = getEmailLocale(user, email_data);
  const redirectTo = email_data.redirect_to;

  if (actionType === "email_change" && user.email && user.new_email) {
    const emails: OutgoingEmail[] = [];

    if (email_data.token_hash_new) {
      emails.push(
        buildAuthEmail({
          to: user.email,
          locale,
          actionType,
          token: email_data.token,
          tokenHash: email_data.token_hash_new,
          redirectTo,
        }),
      );
    }

    if (email_data.token_hash) {
      emails.push(
        buildAuthEmail({
          to: user.new_email,
          locale,
          actionType,
          token: email_data.token_new || email_data.token,
          tokenHash: email_data.token_hash,
          redirectTo,
        }),
      );
    }

    return emails;
  }

  const to = user.email;
  if (!to) throw new Error("user.email is required");

  return [
    buildAuthEmail({
      to,
      locale,
      actionType,
      token: email_data.token,
      tokenHash: email_data.token_hash,
      redirectTo,
    }),
  ];
}

async function sendWithResend(email: OutgoingEmail) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: AUTH_MAIL_FROM,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend failed: ${response.status} ${body}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("not allowed", { status: 400 });
  }

  const rawPayload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const webhook = new Webhook(SEND_EMAIL_HOOK_SECRET);

  try {
    const payload = webhook.verify(rawPayload, headers) as AuthHookPayload;
    const emails = buildOutgoingEmails(payload);

    for (const email of emails) {
      await sendWithResend(email);
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[send-auth-email]", error);

    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});