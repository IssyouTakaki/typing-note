import { createClient } from "npm:@supabase/supabase-js@2";

type Action =
  | "send_verify_email_otp"
  | "verify_email_otp"
  | "start_login_2fa"
  | "verify_login_2fa"
  | "send_change_login_email_otp"
  | "promote_account_email_to_login";

type ResolvedLocale = "ja" | "en";

type RequestBody = {
  action?: Action;
  email?: string;
  accountEmailId?: string;
  otp?: string;
  browserSecret?: string;
  resolvedLocale?: ResolvedLocale;
};

type AuthUser = {
  id: string;
  email?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_LIMIT_WINDOW_MINUTES = 10;
const OTP_RESEND_LIMIT_COUNT = 3;

const LOGIN_2FA_PURPOSE = "step_up";
const LOGIN_EMAIL_CHANGE_PURPOSE = "change_email";
const TRUSTED_BROWSER_DAYS = 30;

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

function localeText(locale: ResolvedLocale, ja: string, en: string) {
  return locale === "ja" ? ja : en;
}

function generateOtp() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1_000_000).padStart(6, "0");
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function buildOtpHash(args: {
  userId: string;
  normalizedEmail: string;
  purpose: string;
  otp: string;
}) {
  const pepper = requiredEnv("OTP_PEPPER");

  return sha256Hex(
    [
      pepper,
      args.userId,
      args.normalizedEmail,
      args.purpose,
      args.otp,
    ].join(":")
  );
}

async function buildBrowserSecretHash(args: {
  userId: string;
  browserSecret: string;
}) {
  const pepper = requiredEnv("OTP_PEPPER");

  return sha256Hex(
    [pepper, args.userId, "trusted_browser", args.browserSecret].join(":")
  );
}

function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  const [domainName = "", ...domainRest] = domain.split(".");

  const maskedLocal =
    local.length <= 1 ? "*" : `${local[0]}${"*".repeat(Math.max(3, local.length - 1))}`;

  const maskedDomainName =
    domainName.length <= 1
      ? "*"
      : `${domainName[0]}${"*".repeat(Math.max(3, domainName.length - 1))}`;

  const suffix = domainRest.length ? `.${domainRest.join(".")}` : "";

  return `${maskedLocal}@${maskedDomainName}${suffix}`;
}

function buildVerifyEmailMessage(
  email: string,
  otp: string,
  resolvedLocale: ResolvedLocale
) {
  const maskedEmail = maskEmail(email);

  if (resolvedLocale === "ja") {
    const subject = "TypingNote サブメール確認コード";

    const text = [
      "TypingNote のサブメール確認コードです。",
      "",
      `送信先: ${maskedEmail}`,
      `確認コード: ${otp}`,
      "",
      `このコードは ${OTP_TTL_MINUTES} 分間有効です。`,
      "この手続きに心当たりがない場合、このメールは破棄して構いません。",
    ].join("\n");

    const html = `
      <p>TypingNote のサブメール確認コードです。</p>
      <p>送信先: <strong>${maskedEmail}</strong></p>
      <p>確認コード: <strong style="font-size: 20px; letter-spacing: 0.12em;">${otp}</strong></p>
      <p>このコードは ${OTP_TTL_MINUTES} 分間有効です。</p>
      <p>この手続きに心当たりがない場合、このメールは破棄して構いません。</p>
    `;

    return { subject, text, html };
  }

  const subject = "TypingNote security email verification";

  const text = [
    "This is your TypingNote security email verification code.",
    "",
    `Destination: ${maskedEmail}`,
    `Verification code: ${otp}`,
    "",
    `This code is valid for ${OTP_TTL_MINUTES} minutes.`,
    "If you did not request this, you can safely ignore this email.",
  ].join("\n");

  const html = `
    <p>This is your TypingNote security email verification code.</p>
    <p>Destination: <strong>${maskedEmail}</strong></p>
    <p>Verification code: <strong style="font-size: 20px; letter-spacing: 0.12em;">${otp}</strong></p>
    <p>This code is valid for ${OTP_TTL_MINUTES} minutes.</p>
    <p>If you did not request this, you can safely ignore this email.</p>
  `;

  return { subject, text, html };
}

function buildLogin2faMessage(
  email: string,
  otp: string,
  resolvedLocale: ResolvedLocale
) {
  const maskedEmail = maskEmail(email);

  if (resolvedLocale === "ja") {
    const subject = "TypingNote ログイン確認コード";

    const text = [
      "TypingNote のログイン確認コードです。",
      "",
      `送信先: ${maskedEmail}`,
      `確認コード: ${otp}`,
      "",
      `このコードは ${OTP_TTL_MINUTES} 分間有効です。`,
      "このログインに心当たりがない場合、パスワードの変更を検討してください。",
    ].join("\n");

    const html = `
      <p>TypingNote のログイン確認コードです。</p>
      <p>送信先: <strong>${maskedEmail}</strong></p>
      <p>確認コード: <strong style="font-size: 20px; letter-spacing: 0.12em;">${otp}</strong></p>
      <p>このコードは ${OTP_TTL_MINUTES} 分間有効です。</p>
      <p>このログインに心当たりがない場合、パスワードの変更を検討してください。</p>
    `;

    return { subject, text, html };
  }

  const subject = "TypingNote login verification code";

  const text = [
    "This is your TypingNote login verification code.",
    "",
    `Destination: ${maskedEmail}`,
    `Verification code: ${otp}`,
    "",
    `This code is valid for ${OTP_TTL_MINUTES} minutes.`,
    "If you did not try to sign in, consider changing your password.",
  ].join("\n");

  const html = `
    <p>This is your TypingNote login verification code.</p>
    <p>Destination: <strong>${maskedEmail}</strong></p>
    <p>Verification code: <strong style="font-size: 20px; letter-spacing: 0.12em;">${otp}</strong></p>
    <p>This code is valid for ${OTP_TTL_MINUTES} minutes.</p>
    <p>If you did not try to sign in, consider changing your password.</p>
  `;

  return { subject, text, html };
}

function buildLoginEmailChangeMessage(
  email: string,
  otp: string,
  resolvedLocale: ResolvedLocale
) {
  const maskedEmail = maskEmail(email);

  if (resolvedLocale === "ja") {
    const subject = "TypingNote ログイン用メールアドレス変更確認コード";

    const text = [
      "TypingNote のログイン用メールアドレス変更確認コードです。",
      "",
      `新しいログイン用メールアドレス: ${maskedEmail}`,
      `確認コード: ${otp}`,
      "",
      `このコードは ${OTP_TTL_MINUTES} 分間有効です。`,
      "この手続きに心当たりがない場合、パスワードを変更し、サブメール設定を確認してください。",
    ].join("\n");

    const html = `
      <p>TypingNote のログイン用メールアドレス変更確認コードです。</p>
      <p>新しいログイン用メールアドレス: <strong>${maskedEmail}</strong></p>
      <p>確認コード: <strong style="font-size: 20px; letter-spacing: 0.12em;">${otp}</strong></p>
      <p>このコードは ${OTP_TTL_MINUTES} 分間有効です。</p>
      <p>この手続きに心当たりがない場合、パスワードを変更し、サブメール設定を確認してください。</p>
    `;

    return { subject, text, html };
  }

  const subject = "TypingNote login email change code";

  const text = [
    "This is your TypingNote login email change verification code.",
    "",
    `New login email: ${maskedEmail}`,
    `Verification code: ${otp}`,
    "",
    `This code is valid for ${OTP_TTL_MINUTES} minutes.`,
    "If you did not request this, change your password and review your security emails.",
  ].join("\n");

  const html = `
    <p>This is your TypingNote login email change verification code.</p>
    <p>New login email: <strong>${maskedEmail}</strong></p>
    <p>Verification code: <strong style="font-size: 20px; letter-spacing: 0.12em;">${otp}</strong></p>
    <p>This code is valid for ${OTP_TTL_MINUTES} minutes.</p>
    <p>If you did not request this, change your password and review your security emails.</p>
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

async function getAuthenticatedUser(req: Request): Promise<AuthUser> {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const anonKey = requiredEnv("SUPABASE_ANON_KEY");

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

  const { data, error } = await userClient.auth.getUser();

  if (error || !data.user) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return {
    id: data.user.id,
    email: data.user.email ?? undefined,
  };
}

function createAdminClient() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

async function sendVerifyEmailOtp(req: Request, body: RequestBody) {
  const user = await getAuthenticatedUser(req);
  const email = normalizeEmail(String(body.email ?? ""));

  if (!email) {
    return json({ error: "email is required" }, 400);
  }

  if (user.email && normalizeEmail(user.email) === email) {
    return json(
      {
        error: "login_email_cannot_be_added_as_sub_email",
        message: "ログイン用メールアドレスはサブメールとして追加できません。",
      },
      400
    );
  }

  const admin = createAdminClient();

  const { data: existingAccountEmail, error: findEmailError } = await admin
    .from("account_emails")
    .select("id,email,is_verified")
    .eq("user_id", user.id)
    .eq("normalized_email", email)
    .maybeSingle();

  if (findEmailError) throw findEmailError;

  let accountEmail = existingAccountEmail;

  if (!accountEmail) {
    const { data: inserted, error: insertError } = await admin
      .from("account_emails")
      .insert({
        user_id: user.id,
        email,
      })
      .select("id,email,normalized_email,is_verified")
      .single();

    if (insertError) throw insertError;
    accountEmail = inserted;
  }

  if (accountEmail.is_verified) {
    return json({
      status: "already_verified",
      message: "このメールアドレスはすでに確認済みです。",
      accountEmailId: accountEmail.id,
      maskedEmail: maskEmail(email),
    });
  }

  const resendWindowStart = new Date(
    Date.now() - OTP_RESEND_LIMIT_WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  const { count, error: countError } = await admin
    .from("account_email_otp_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("purpose", "verify_email")
    .eq("normalized_email", email)
    .gte("created_at", resendWindowStart);

  if (countError) throw countError;

  if ((count ?? 0) >= OTP_RESEND_LIMIT_COUNT) {
    return json(
      {
        error: "too_many_otp_requests",
        message: "確認コードの送信回数が多すぎます。しばらくしてから再度お試しください。",
      },
      429
    );
  }

  const otp = generateOtp();
  const otpHash = await buildOtpHash({
    userId: user.id,
    normalizedEmail: email,
    purpose: "verify_email",
    otp,
  });

  const expiresAt = new Date(
    Date.now() + OTP_TTL_MINUTES * 60 * 1000
  ).toISOString();

  const { error: insertChallengeError } = await admin
    .from("account_email_otp_challenges")
    .insert({
      user_id: user.id,
      account_email_id: accountEmail.id,
      normalized_email: email,
      purpose: "verify_email",
      otp_hash: otpHash,
      expires_at: expiresAt,
      max_attempts: OTP_MAX_ATTEMPTS,
    });

  if (insertChallengeError) throw insertChallengeError;

  const resolvedLocale = normalizeResolvedLocale(body.resolvedLocale);
  const message = buildVerifyEmailMessage(email, otp, resolvedLocale);

  await sendEmail({
    to: email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return json({
    status: "sent",
    message: "確認コードを送信しました。",
    accountEmailId: accountEmail.id,
    maskedEmail: maskEmail(email),
    expiresInMinutes: OTP_TTL_MINUTES,
  });
}

async function verifyEmailOtp(req: Request, body: RequestBody) {
  const user = await getAuthenticatedUser(req);
  const accountEmailId = String(body.accountEmailId ?? "");
  const otp = String(body.otp ?? "").trim();

  if (!accountEmailId) {
    return json({ error: "accountEmailId is required" }, 400);
  }

  if (!/^\d{6}$/.test(otp)) {
    return json(
      {
        error: "invalid_otp_format",
        message: "確認コードは6桁の数字で入力してください。",
      },
      400
    );
  }

  const admin = createAdminClient();

  const { data: accountEmail, error: accountEmailError } = await admin
    .from("account_emails")
    .select("id,email,normalized_email,is_verified")
    .eq("id", accountEmailId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (accountEmailError) throw accountEmailError;

  if (!accountEmail) {
    return json(
      {
        error: "account_email_not_found",
        message: "対象のメールアドレスが見つかりません。",
      },
      404
    );
  }

  if (accountEmail.is_verified) {
    return json({
      status: "already_verified",
      message: "このメールアドレスはすでに確認済みです。",
      accountEmailId: accountEmail.id,
      maskedEmail: maskEmail(accountEmail.email),
    });
  }

  const { data: challenge, error: challengeError } = await admin
    .from("account_email_otp_challenges")
    .select(
      "id,normalized_email,otp_hash,expires_at,attempts,max_attempts,consumed_at"
    )
    .eq("user_id", user.id)
    .eq("account_email_id", accountEmail.id)
    .eq("purpose", "verify_email")
    .eq("normalized_email", accountEmail.normalized_email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (challengeError) throw challengeError;

  if (!challenge) {
    return json(
      {
        error: "otp_not_found",
        message: "有効な確認コードが見つかりません。再送してください。",
      },
      400
    );
  }

  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return json(
      {
        error: "otp_expired",
        message: "確認コードの有効期限が切れています。再送してください。",
      },
      400
    );
  }

  if (challenge.attempts >= challenge.max_attempts) {
    return json(
      {
        error: "too_many_attempts",
        message: "確認コードの入力回数が上限に達しました。再送してください。",
      },
      429
    );
  }

  const otpHash = await buildOtpHash({
    userId: user.id,
    normalizedEmail: accountEmail.normalized_email,
    purpose: "verify_email",
    otp,
  });

  if (otpHash !== challenge.otp_hash) {
    const { error: updateAttemptsError } = await admin
      .from("account_email_otp_challenges")
      .update({
        attempts: challenge.attempts + 1,
      })
      .eq("id", challenge.id);

    if (updateAttemptsError) throw updateAttemptsError;

    return json(
      {
        error: "invalid_otp",
        message: "確認コードが正しくありません。",
        remainingAttempts: Math.max(
          0,
          challenge.max_attempts - (challenge.attempts + 1)
        ),
      },
      400
    );
  }

  const now = new Date().toISOString();

  const { error: consumeError } = await admin
    .from("account_email_otp_challenges")
    .update({
      consumed_at: now,
    })
    .eq("id", challenge.id);

  if (consumeError) throw consumeError;

const { error: verifyEmailError } = await admin
  .from("account_emails")
  .update({
    is_verified: true,
    verified_at: now,
    use_for_recovery: true,
    use_for_2fa: true,
  })
  .eq("id", accountEmail.id)
  .eq("user_id", user.id);

  if (verifyEmailError) throw verifyEmailError;

  return json({
    status: "verified",
    message: "メールアドレスを確認しました。",
    accountEmailId: accountEmail.id,
    maskedEmail: maskEmail(accountEmail.email),
  });
}

async function getLogin2faTarget(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
) {
  const { data, error } = await admin
    .from("account_emails")
    .select("id,email,normalized_email")
    .eq("user_id", userId)
    .eq("is_verified", true)
    .eq("use_for_2fa", true)
    .not("normalized_email", "is", null)
    .order("verified_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function isTrustedBrowser(args: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  browserSecret: string;
}) {
  if (!args.browserSecret) return false;

  const browserSecretHash = await buildBrowserSecretHash({
    userId: args.userId,
    browserSecret: args.browserSecret,
  });

  const trustedSince = new Date(
    Date.now() - TRUSTED_BROWSER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await args.admin
    .from("account_trusted_browsers")
    .select("id,last_verified_at,revoked_at")
    .eq("user_id", args.userId)
    .eq("browser_secret_hash", browserSecretHash)
    .is("revoked_at", null)
    .gte("last_verified_at", trustedSince)
    .maybeSingle();

  if (error) throw error;

  return Boolean(data);
}

async function startLogin2fa(req: Request, body: RequestBody) {
  const user = await getAuthenticatedUser(req);
  const admin = createAdminClient();
  const browserSecret = String(body.browserSecret ?? "").trim();
  const resolvedLocale = normalizeResolvedLocale(body.resolvedLocale);

  const target = await getLogin2faTarget(admin, user.id);

  if (!target) {
    return json({
      required: false,
      reason: "no_2fa_email",
    });
  }

  if (
    await isTrustedBrowser({
      admin,
      userId: user.id,
      browserSecret,
    })
  ) {
    return json({
      required: false,
      reason: "trusted_browser",
    });
  }

  const resendWindowStart = new Date(
    Date.now() - OTP_RESEND_LIMIT_WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  const { count, error: countError } = await admin
    .from("account_email_otp_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("purpose", LOGIN_2FA_PURPOSE)
    .eq("account_email_id", target.id)
    .gte("created_at", resendWindowStart);

  if (countError) throw countError;

  if ((count ?? 0) >= OTP_RESEND_LIMIT_COUNT) {
    return json(
      {
        error: "too_many_otp_requests",
        message: "確認コードの送信回数が多すぎます。しばらくしてから再度お試しください。",
      },
      429
    );
  }

  const otp = generateOtp();

  const otpHash = await buildOtpHash({
    userId: user.id,
    normalizedEmail: target.normalized_email,
    purpose: LOGIN_2FA_PURPOSE,
    otp,
  });

  const expiresAt = new Date(
    Date.now() + OTP_TTL_MINUTES * 60 * 1000
  ).toISOString();

  const { error: insertChallengeError } = await admin
    .from("account_email_otp_challenges")
    .insert({
      user_id: user.id,
      account_email_id: target.id,
      normalized_email: target.normalized_email,
      purpose: LOGIN_2FA_PURPOSE,
      otp_hash: otpHash,
      expires_at: expiresAt,
      max_attempts: OTP_MAX_ATTEMPTS,
    });

  if (insertChallengeError) throw insertChallengeError;

  const message = buildLogin2faMessage(target.email, otp, resolvedLocale);

  await sendEmail({
    to: target.email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return json({
    required: true,
    message: "ログイン確認コードを送信しました。",
    accountEmailId: target.id,
    maskedEmail: maskEmail(target.email),
    expiresInMinutes: OTP_TTL_MINUTES,
  });
}

async function verifyLogin2fa(req: Request, body: RequestBody) {
  const user = await getAuthenticatedUser(req);
  const accountEmailId = String(body.accountEmailId ?? "");
  const otp = String(body.otp ?? "").trim();
  const browserSecret = String(body.browserSecret ?? "").trim();

  if (!accountEmailId) {
    return json({ error: "accountEmailId is required" }, 400);
  }

  if (!browserSecret) {
    return json(
      {
        error: "browser_secret_required",
        message: "ブラウザ確認情報を取得できませんでした。再度ログインしてください。",
      },
      400
    );
  }

  if (!/^\d{6}$/.test(otp)) {
    return json(
      {
        error: "invalid_otp_format",
        message: "確認コードは6桁の数字で入力してください。",
      },
      400
    );
  }

  const admin = createAdminClient();

  const { data: accountEmail, error: accountEmailError } = await admin
    .from("account_emails")
    .select("id,email,normalized_email,is_verified,use_for_2fa")
    .eq("id", accountEmailId)
    .eq("user_id", user.id)
    .eq("is_verified", true)
    .eq("use_for_2fa", true)
    .maybeSingle();

  if (accountEmailError) throw accountEmailError;

  if (!accountEmail) {
    return json(
      {
        error: "account_email_not_found",
        message: "2FA送信先のメールアドレスが見つかりません。",
      },
      404
    );
  }

  const { data: challenge, error: challengeError } = await admin
    .from("account_email_otp_challenges")
    .select(
      "id,normalized_email,otp_hash,expires_at,attempts,max_attempts,consumed_at"
    )
    .eq("user_id", user.id)
    .eq("account_email_id", accountEmail.id)
    .eq("purpose", LOGIN_2FA_PURPOSE)
    .eq("normalized_email", accountEmail.normalized_email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (challengeError) throw challengeError;

  if (!challenge) {
    return json(
      {
        error: "otp_not_found",
        message: "有効な確認コードが見つかりません。再送してください。",
      },
      400
    );
  }

  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return json(
      {
        error: "otp_expired",
        message: "確認コードの有効期限が切れています。再送してください。",
      },
      400
    );
  }

  if (challenge.attempts >= challenge.max_attempts) {
    return json(
      {
        error: "too_many_attempts",
        message: "確認コードの入力回数が上限に達しました。再送してください。",
      },
      429
    );
  }

  const otpHash = await buildOtpHash({
    userId: user.id,
    normalizedEmail: accountEmail.normalized_email,
    purpose: LOGIN_2FA_PURPOSE,
    otp,
  });

  if (otpHash !== challenge.otp_hash) {
    const { error: updateAttemptsError } = await admin
      .from("account_email_otp_challenges")
      .update({
        attempts: challenge.attempts + 1,
      })
      .eq("id", challenge.id);

    if (updateAttemptsError) throw updateAttemptsError;

    return json(
      {
        error: "invalid_otp",
        message: "確認コードが正しくありません。",
        remainingAttempts: Math.max(
          0,
          challenge.max_attempts - (challenge.attempts + 1)
        ),
      },
      400
    );
  }

  const now = new Date().toISOString();

  const { error: consumeError } = await admin
    .from("account_email_otp_challenges")
    .update({
      consumed_at: now,
    })
    .eq("id", challenge.id);

  if (consumeError) throw consumeError;

  const browserSecretHash = await buildBrowserSecretHash({
    userId: user.id,
    browserSecret,
  });

  const { error: trustError } = await admin
    .from("account_trusted_browsers")
    .upsert(
      {
        user_id: user.id,
        browser_secret_hash: browserSecretHash,
        last_verified_at: now,
        revoked_at: null,
        updated_at: now,
      },
      {
        onConflict: "user_id,browser_secret_hash",
      }
    );

  if (trustError) throw trustError;

  return json({
    status: "verified",
    message: "二段階認証が完了しました。",
    trustedDays: TRUSTED_BROWSER_DAYS,
  });
}

async function sendChangeLoginEmailOtp(req: Request, body: RequestBody) {
  const user = await getAuthenticatedUser(req);
  const accountEmailId = String(body.accountEmailId ?? "");
  const resolvedLocale = normalizeResolvedLocale(body.resolvedLocale);

  if (!accountEmailId) {
    return json({ error: "accountEmailId is required" }, 400);
  }

  const admin = createAdminClient();

  const { data: accountEmail, error: accountEmailError } = await admin
    .from("account_emails")
    .select("id,email,normalized_email,is_verified")
    .eq("id", accountEmailId)
    .eq("user_id", user.id)
    .eq("is_verified", true)
    .maybeSingle();

  if (accountEmailError) throw accountEmailError;

  if (!accountEmail) {
    return json(
      {
        error: "account_email_not_found",
        message: localeText(
          resolvedLocale,
          "先に確認済みのサブメールを選択してください。",
          "Choose a verified security email first."
        ),
      },
      404
    );
  }

  if (user.email && normalizeEmail(user.email) === accountEmail.normalized_email) {
    return json(
      {
        error: "already_login_email",
        message: localeText(
          resolvedLocale,
          "このメールアドレスはすでにログイン用メールアドレスです。",
          "This email is already the login email."
        ),
      },
      400
    );
  }

  const resendWindowStart = new Date(
    Date.now() - OTP_RESEND_LIMIT_WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  const { count, error: countError } = await admin
    .from("account_email_otp_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("purpose", LOGIN_EMAIL_CHANGE_PURPOSE)
    .eq("account_email_id", accountEmail.id)
    .gte("created_at", resendWindowStart);

  if (countError) throw countError;

  if ((count ?? 0) >= OTP_RESEND_LIMIT_COUNT) {
    return json(
      {
        error: "too_many_otp_requests",
        message: localeText(
          resolvedLocale,
          "確認コードの送信回数が多すぎます。しばらくしてから再度お試しください。",
          "Too many verification code requests. Please try again later."
        ),
      },
      429
    );
  }

  const otp = generateOtp();
  const otpHash = await buildOtpHash({
    userId: user.id,
    normalizedEmail: accountEmail.normalized_email,
    purpose: LOGIN_EMAIL_CHANGE_PURPOSE,
    otp,
  });

  const expiresAt = new Date(
    Date.now() + OTP_TTL_MINUTES * 60 * 1000
  ).toISOString();

  const { error: insertChallengeError } = await admin
    .from("account_email_otp_challenges")
    .insert({
      user_id: user.id,
      account_email_id: accountEmail.id,
      normalized_email: accountEmail.normalized_email,
      purpose: LOGIN_EMAIL_CHANGE_PURPOSE,
      otp_hash: otpHash,
      expires_at: expiresAt,
      max_attempts: OTP_MAX_ATTEMPTS,
    });

  if (insertChallengeError) throw insertChallengeError;

  const message = buildLoginEmailChangeMessage(
    accountEmail.email,
    otp,
    resolvedLocale
  );

  await sendEmail({
    to: accountEmail.email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return json({
    status: "sent",
    message: localeText(
      resolvedLocale,
      "新しいログイン用メールアドレス宛に確認コードを送信しました。",
      "Verification code sent to the new login email."
    ),
    accountEmailId: accountEmail.id,
    maskedEmail: maskEmail(accountEmail.email),
    expiresInMinutes: OTP_TTL_MINUTES,
  });
}

async function promoteAccountEmailToLogin(req: Request, body: RequestBody) {
  const user = await getAuthenticatedUser(req);
  const accountEmailId = String(body.accountEmailId ?? "");
  const otp = String(body.otp ?? "").trim();
  const resolvedLocale = normalizeResolvedLocale(body.resolvedLocale);

  if (!accountEmailId) {
    return json({ error: "accountEmailId is required" }, 400);
  }

  if (!/^\d{6}$/.test(otp)) {
    return json(
      {
        error: "invalid_otp_format",
        message: localeText(
          resolvedLocale,
          "確認コードは6桁の数字で入力してください。",
          "Verification code must be 6 digits."
        ),
      },
      400
    );
  }

  const admin = createAdminClient();

  const { data: accountEmail, error: accountEmailError } = await admin
    .from("account_emails")
    .select("id,email,normalized_email,is_verified")
    .eq("id", accountEmailId)
    .eq("user_id", user.id)
    .eq("is_verified", true)
    .maybeSingle();

  if (accountEmailError) throw accountEmailError;

  if (!accountEmail) {
    return json(
      {
        error: "account_email_not_found",
        message: localeText(
          resolvedLocale,
          "先に確認済みのサブメールを選択してください。",
          "Choose a verified security email first."
        ),
      },
      404
    );
  }

  if (user.email && normalizeEmail(user.email) === accountEmail.normalized_email) {
    return json(
      {
        error: "already_login_email",
        message: localeText(
          resolvedLocale,
          "このメールアドレスはすでにログイン用メールアドレスです。",
          "This email is already the login email."
        ),
      },
      400
    );
  }

  const { data: challenge, error: challengeError } = await admin
    .from("account_email_otp_challenges")
    .select(
      "id,normalized_email,otp_hash,expires_at,attempts,max_attempts,consumed_at"
    )
    .eq("user_id", user.id)
    .eq("account_email_id", accountEmail.id)
    .eq("purpose", LOGIN_EMAIL_CHANGE_PURPOSE)
    .eq("normalized_email", accountEmail.normalized_email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (challengeError) throw challengeError;

  if (!challenge) {
    return json(
      {
        error: "otp_not_found",
        message: localeText(
          resolvedLocale,
          "有効な確認コードが見つかりません。再送してください。",
          "No active verification code was found. Please send a new code."
        ),
      },
      400
    );
  }

  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return json(
      {
        error: "otp_expired",
        message: localeText(
          resolvedLocale,
          "確認コードの有効期限が切れています。再送してください。",
          "The verification code has expired. Please send a new code."
        ),
      },
      400
    );
  }

  if (challenge.attempts >= challenge.max_attempts) {
    return json(
      {
        error: "too_many_attempts",
        message: localeText(
          resolvedLocale,
          "確認コードの入力回数が上限に達しました。再送してください。",
          "Too many verification attempts. Please send a new code."
        ),
      },
      429
    );
  }

  const otpHash = await buildOtpHash({
    userId: user.id,
    normalizedEmail: accountEmail.normalized_email,
    purpose: LOGIN_EMAIL_CHANGE_PURPOSE,
    otp,
  });

  if (otpHash !== challenge.otp_hash) {
    const { error: updateAttemptsError } = await admin
      .from("account_email_otp_challenges")
      .update({
        attempts: challenge.attempts + 1,
      })
      .eq("id", challenge.id);

    if (updateAttemptsError) throw updateAttemptsError;

    return json(
      {
        error: "invalid_otp",
        message: localeText(
          resolvedLocale,
          "確認コードが正しくありません。",
          "The verification code is incorrect."
        ),
        remainingAttempts: Math.max(
          0,
          challenge.max_attempts - (challenge.attempts + 1)
        ),
      },
      400
    );
  }

  const now = new Date().toISOString();
  const oldLoginEmail = user.email ? normalizeEmail(user.email) : "";

  const { error: consumeError } = await admin
    .from("account_email_otp_challenges")
    .update({
      consumed_at: now,
    })
    .eq("id", challenge.id);

  if (consumeError) throw consumeError;

  const { error: updateUserError } = await admin.auth.admin.updateUserById(
    user.id,
    {
      email: accountEmail.email,
      email_confirm: true,
    }
  );

  if (updateUserError) throw updateUserError;

  const cleanupErrors: string[] = [];

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      email: accountEmail.email,
    })
    .eq("id", user.id);

  if (profileError) {
    cleanupErrors.push("profile_email_sync_failed");
    console.warn("profile email sync failed", profileError);
  }

  const { error: deletePromotedEmailError } = await admin
    .from("account_emails")
    .delete()
    .eq("id", accountEmail.id)
    .eq("user_id", user.id);

  if (deletePromotedEmailError) {
    cleanupErrors.push("promoted_security_email_cleanup_failed");
    console.warn("promoted security email cleanup failed", deletePromotedEmailError);
  }

  let oldLoginEmailRetained = false;

  if (oldLoginEmail && oldLoginEmail !== accountEmail.normalized_email) {
    const { data: existingOldEmail, error: findOldEmailError } = await admin
      .from("account_emails")
      .select("id")
      .eq("user_id", user.id)
      .eq("normalized_email", oldLoginEmail)
      .maybeSingle();

    if (findOldEmailError) {
      cleanupErrors.push("old_login_email_lookup_failed");
      console.warn("old login email lookup failed", findOldEmailError);
    } else if (existingOldEmail) {
      const { error: updateOldEmailError } = await admin
        .from("account_emails")
        .update({
          email: oldLoginEmail,
          is_verified: true,
          verified_at: now,
          use_for_2fa: false,
          use_for_recovery: false,
          use_for_notification: false,
        })
        .eq("id", existingOldEmail.id)
        .eq("user_id", user.id);

      if (updateOldEmailError) {
        cleanupErrors.push("old_login_email_update_failed");
        console.warn("old login email update failed", updateOldEmailError);
      } else {
        oldLoginEmailRetained = true;
      }
    } else {
      const { error: insertOldEmailError } = await admin
        .from("account_emails")
        .insert({
          user_id: user.id,
          email: oldLoginEmail,
          is_verified: true,
          verified_at: now,
          use_for_2fa: false,
          use_for_recovery: false,
          use_for_notification: false,
        });

      if (insertOldEmailError) {
        cleanupErrors.push("old_login_email_insert_failed");
        console.warn("old login email insert failed", insertOldEmailError);
      } else {
        oldLoginEmailRetained = true;
      }
    }
  }

  return json({
    status: "changed",
    message:
      cleanupErrors.length > 0
        ? localeText(
            resolvedLocale,
            "ログイン用メールアドレスを変更しました。一部の後処理を確認してください。",
            "Login email changed. Some cleanup steps need review."
          )
        : localeText(
            resolvedLocale,
            "ログイン用メールアドレスを変更しました。",
            "Login email changed."
          ),
    loginEmail: accountEmail.email,
    maskedLoginEmail: maskEmail(accountEmail.email),
    oldLoginEmailRetained,
    cleanupErrors,
  });
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

    switch (body.action) {
      case "send_verify_email_otp":
        return await sendVerifyEmailOtp(req, body);

      case "verify_email_otp":
        return await verifyEmailOtp(req, body);

      case "start_login_2fa":
        return await startLogin2fa(req, body);

      case "verify_login_2fa":
        return await verifyLogin2fa(req, body);

      case "send_change_login_email_otp":
        return await sendChangeLoginEmailOtp(req, body);

      case "promote_account_email_to_login":
        return await promoteAccountEmailToLogin(req, body);

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("account-security failed", error);

    return json(
      {
        error: "internal_error",
        message: "処理を完了できませんでした。しばらくしてから再度お試しください。",
      },
      500
    );
  }
});
