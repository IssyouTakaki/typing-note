// deno-lint-ignore no-import-prefix
import { createClient } from "npm:@supabase/supabase-js@2";

type ResolvedLocale = "ja" | "en";
type Action =
  | "start_deletion"
  | "confirm_deletion"
  | "restore_account"
  | "resend_recovery_code";

type RequestBody = {
  action?: Action;
  password?: string;
  otp?: string;
  email?: string;
  recoveryCode?: string;
  resolvedLocale?: ResolvedLocale;
};

type AuthContext = {
  userId: string;
  email: string;
  accessToken: string;
};

type DeletionRequest = {
  id: string;
  user_id: string;
  normalized_login_email: string;
  resolved_locale: ResolvedLocale;
  status: "preparing" | "pending" | "restoring" | "purging";
  scheduled_deletion_at: string;
  recovery_failed_attempts: number;
  recovery_locked_until: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OTP_PURPOSE = "delete_account";
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_WINDOW_MINUTES = 10;
const OTP_RESEND_LIMIT = 3;
const RECOVERY_FAILURE_LIMIT = 10;
const RECOVERY_LOCK_MINUTES = 60;
const RECOVERY_RESEND_WINDOW_MINUTES = 60;
const RECOVERY_CODE_LIMIT = 5;
const LONG_BAN_DURATION = "876000h";

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

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

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeLocale(value: unknown): ResolvedLocale {
  return value === "ja" ? "ja" : "en";
}

function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  const [domainName = "", ...suffixParts] = domain.split(".");
  const maskedLocal = local.length <= 1
    ? "*"
    : `${local[0]}${"*".repeat(Math.max(3, local.length - 1))}`;
  const maskedDomain = domainName.length <= 1
    ? "*"
    : `${domainName[0]}${"*".repeat(Math.max(3, domainName.length - 1))}`;
  const suffix = suffixParts.length ? `.${suffixParts.join(".")}` : "";
  return `${maskedLocal}@${maskedDomain}${suffix}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function generateOtp() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

function generateRecoveryCode() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `TN-${hex.match(/.{1,8}/g)?.join("-") ?? hex}`;
}

function normalizeRecoveryCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildOtpHash(args: {
  userId: string;
  normalizedEmail: string;
  otp: string;
}) {
  return sha256Hex(
    [
      requiredEnv("OTP_PEPPER"),
      args.userId,
      args.normalizedEmail,
      OTP_PURPOSE,
      args.otp,
    ].join(":"),
  );
}

function buildRecoveryCodeHash(userId: string, code: string) {
  return sha256Hex(
    [
      requiredEnv("ACCOUNT_RECOVERY_PEPPER"),
      userId,
      "account_recovery",
      normalizeRecoveryCode(code),
    ].join(":"),
  );
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
    },
  );
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function getAuthenticatedContext(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) throw new HttpError(401, "unauthorized", "Unauthorized");

  const client = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_ANON_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: { headers: { Authorization: authHeader } },
    },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email) {
    throw new HttpError(401, "unauthorized", "Unauthorized");
  }

  return {
    userId: data.user.id,
    email: data.user.email,
    accessToken,
  };
}

function collectAuthProviderIds(user: unknown): string[] {
  const providerIds = new Set<string>();
  const record = user as {
    app_metadata?: {
      provider?: unknown;
      providers?: unknown;
    };
    identities?: Array<{ provider?: unknown }>;
  } | null;

  const primaryProvider = record?.app_metadata?.provider;
  if (typeof primaryProvider === "string" && primaryProvider) {
    providerIds.add(primaryProvider);
  }

  const providers = record?.app_metadata?.providers;
  if (Array.isArray(providers)) {
    providers.forEach((provider) => {
      if (typeof provider === "string" && provider) providerIds.add(provider);
    });
  }

  record?.identities?.forEach((identity) => {
    if (typeof identity.provider === "string" && identity.provider) {
      providerIds.add(identity.provider);
    }
  });

  return [...providerIds];
}

async function userRequiresPasswordForDeletion(
  admin: AdminClient,
  userId: string,
) {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw error;

  const providers = collectAuthProviderIds(data.user);
  if (providers.length === 0) return true;

  return providers.includes("email");
}

async function verifyCurrentPassword(context: AuthContext, password: string) {
  if (!password) {
    throw new HttpError(
      400,
      "password_required",
      "Current password is required.",
    );
  }

  const verifier = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_ANON_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
  const { data, error } = await verifier.auth.signInWithPassword({
    email: context.email,
    password,
  });

  if (error || data.user?.id !== context.userId || !data.session) {
    throw new HttpError(
      401,
      "invalid_password",
      "Current password is incorrect.",
    );
  }

  const admin = createAdminClient();
  await admin.auth.admin.signOut(data.session.access_token, "local");
}

async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: requiredEnv("AUTH_MAIL_FROM"),
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend API error: ${response.status} ${body}`);
  }
}

function buildDeletionOtpMessage(
  email: string,
  otp: string,
  locale: ResolvedLocale,
) {
  const safeEmail = escapeHtml(email);
  if (locale === "ja") {
    return {
      subject: "TypingNote アカウント削除確認コード",
      text: [
        "TypingNote のアカウント削除確認コードです。",
        "",
        `送信先: ${email}`,
        `確認コード: ${otp}`,
        "",
        `このコードは ${OTP_TTL_MINUTES} 分間有効です。`,
        "このコードを入力しても、30日間の削除猶予期間が始まるだけです。",
        "心当たりがない場合はアカウントのセキュリティ設定を確認してください。",
      ].join("\n"),
      html: `
        <p>TypingNote のアカウント削除確認コードです。</p>
        <p>送信先: <strong>${safeEmail}</strong></p>
        <p>確認コード: <strong style="font-size:20px;letter-spacing:.12em">${otp}</strong></p>
        <p>このコードは ${OTP_TTL_MINUTES} 分間有効です。</p>
        <p>このコードを入力しても、30日間の削除猶予期間が始まるだけです。</p>
        <p>心当たりがない場合はアカウントのセキュリティ設定を確認してください。</p>
      `,
    };
  }

  return {
    subject: "TypingNote account deletion verification code",
    text: [
      "This is your TypingNote account deletion verification code.",
      "",
      `Destination: ${email}`,
      `Verification code: ${otp}`,
      "",
      `This code is valid for ${OTP_TTL_MINUTES} minutes.`,
      "Confirming it only starts the 30-day recovery period.",
      "If you did not request this, review your account security settings.",
    ].join("\n"),
    html: `
      <p>This is your TypingNote account deletion verification code.</p>
      <p>Destination: <strong>${safeEmail}</strong></p>
      <p>Verification code: <strong style="font-size:20px;letter-spacing:.12em">${otp}</strong></p>
      <p>This code is valid for ${OTP_TTL_MINUTES} minutes.</p>
      <p>Confirming it only starts the 30-day recovery period.</p>
      <p>If you did not request this, review your account security settings.</p>
    `,
  };
}

function buildRecoveryMessage(
  code: string,
  scheduledDeletionAt: string,
  locale: ResolvedLocale,
) {
  const safeCode = escapeHtml(code);
  const safeDeadline = escapeHtml(scheduledDeletionAt);
  if (locale === "ja") {
    return {
      subject: "TypingNote アカウント復元コード",
      text: [
        "TypingNote アカウントの削除予約を受け付けました。",
        "",
        `復元コード: ${code}`,
        `復元期限: ${scheduledDeletionAt}`,
        "",
        "期限より前に復元画面でログインメールと復元コードを入力すると、削除予約を取り消せます。",
        "このコードは他人に知らせないでください。",
      ].join("\n"),
      html: `
        <p>TypingNote アカウントの削除予約を受け付けました。</p>
        <p>復元コード:</p>
        <p><strong style="font-size:18px;letter-spacing:.08em">${safeCode}</strong></p>
        <p>復元期限: <strong>${safeDeadline}</strong></p>
        <p>期限より前に復元画面でログインメールと復元コードを入力すると、削除予約を取り消せます。</p>
        <p>このコードは他人に知らせないでください。</p>
      `,
    };
  }

  return {
    subject: "TypingNote account recovery code",
    text: [
      "Your TypingNote account is scheduled for deletion.",
      "",
      `Recovery code: ${code}`,
      `Recovery deadline: ${scheduledDeletionAt}`,
      "",
      "Before the deadline, enter your login email and recovery code on the recovery screen to cancel deletion.",
      "Do not share this code.",
    ].join("\n"),
    html: `
      <p>Your TypingNote account is scheduled for deletion.</p>
      <p>Recovery code:</p>
      <p><strong style="font-size:18px;letter-spacing:.08em">${safeCode}</strong></p>
      <p>Recovery deadline: <strong>${safeDeadline}</strong></p>
      <p>Before the deadline, enter your login email and recovery code on the recovery screen to cancel deletion.</p>
      <p>Do not share this code.</p>
    `,
  };
}

async function getRecoveryDestinations(
  userId: string,
  loginEmail: string,
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("account_emails")
    .select("email")
    .eq("user_id", userId)
    .eq("is_verified", true)
    .eq("use_for_recovery", true);
  if (error) throw error;

  const destinations = new Map<string, string>();
  destinations.set(normalizeEmail(loginEmail), loginEmail);
  for (const row of data ?? []) {
    const email = String(row.email ?? "").trim();
    if (email) destinations.set(normalizeEmail(email), email);
  }
  return [...destinations.values()];
}

async function sendRecoveryCode(args: {
  requestId: string;
  userId: string;
  loginEmail: string;
  locale: ResolvedLocale;
  scheduledDeletionAt: string;
}) {
  const admin = createAdminClient();
  const recoveryCode = generateRecoveryCode();
  const codeHash = await buildRecoveryCodeHash(args.userId, recoveryCode);
  const { data: codeRow, error: insertError } = await admin
    .from("account_deletion_recovery_codes")
    .insert({
      request_id: args.requestId,
      code_hash: codeHash,
      expires_at: args.scheduledDeletionAt,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  let destinations: string[];
  let results: PromiseSettledResult<void>[];
  try {
    destinations = await getRecoveryDestinations(args.userId, args.loginEmail);
    const message = buildRecoveryMessage(
      recoveryCode,
      args.scheduledDeletionAt,
      args.locale,
    );
    results = await Promise.allSettled(
      destinations.map((to) => sendEmail({ to, ...message })),
    );
  } catch (error) {
    await admin
      .from("account_deletion_recovery_codes")
      .delete()
      .eq("id", codeRow.id);
    throw error;
  }
  const loginIndex = destinations.findIndex(
    (email) => normalizeEmail(email) === normalizeEmail(args.loginEmail),
  );
  const loginDelivered = loginIndex >= 0 &&
    results[loginIndex]?.status === "fulfilled";
  const deliveredCount = results.filter(
    (result) => result.status === "fulfilled",
  ).length;

  if (!loginDelivered || deliveredCount === 0) {
    await admin
      .from("account_deletion_recovery_codes")
      .delete()
      .eq("id", codeRow.id);
    throw new Error("Recovery code delivery to the login email failed");
  }

  return {
    destinationCount: destinations.length,
    deliveredCount,
  };
}

async function startDeletion(req: Request, body: RequestBody) {
  const context = await getAuthenticatedContext(req);
  const locale = normalizeLocale(body.resolvedLocale);
  const admin = createAdminClient();

  if (await userRequiresPasswordForDeletion(admin, context.userId)) {
    await verifyCurrentPassword(context, String(body.password ?? ""));
  }

  const { data: existing, error: existingError } = await admin
    .from("account_deletion_requests")
    .select("status,scheduled_deletion_at")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.status === "pending" || existing?.status === "purging") {
    throw new HttpError(
      409,
      "deletion_already_pending",
      "Account deletion is already scheduled.",
    );
  }
  if (existing) {
    const { error } = await admin
      .from("account_deletion_requests")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw error;
  }

  const normalizedEmail = normalizeEmail(context.email);
  const windowStart = new Date(
    Date.now() - OTP_RESEND_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();
  const { count, error: countError } = await admin
    .from("account_email_otp_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", context.userId)
    .eq("purpose", OTP_PURPOSE)
    .gte("created_at", windowStart);
  if (countError) throw countError;
  if ((count ?? 0) >= OTP_RESEND_LIMIT) {
    throw new HttpError(
      429,
      "too_many_otp_requests",
      "Too many verification code requests. Please try again later.",
    );
  }

  const otp = generateOtp();
  const otpHash = await buildOtpHash({
    userId: context.userId,
    normalizedEmail,
    otp,
  });
  const expiresAt = new Date(
    Date.now() + OTP_TTL_MINUTES * 60 * 1000,
  ).toISOString();
  const { data: challenge, error: insertError } = await admin
    .from("account_email_otp_challenges")
    .insert({
      user_id: context.userId,
      account_email_id: null,
      normalized_email: normalizedEmail,
      purpose: OTP_PURPOSE,
      otp_hash: otpHash,
      expires_at: expiresAt,
      max_attempts: OTP_MAX_ATTEMPTS,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  try {
    await sendEmail({
      to: context.email,
      ...buildDeletionOtpMessage(context.email, otp, locale),
    });
  } catch (error) {
    await admin
      .from("account_email_otp_challenges")
      .delete()
      .eq("id", challenge.id);
    throw error;
  }

  return json({
    status: "otp_sent",
    maskedEmail: maskEmail(context.email),
    expiresInMinutes: OTP_TTL_MINUTES,
  });
}

async function confirmDeletion(req: Request, body: RequestBody) {
  const context = await getAuthenticatedContext(req);
  const locale = normalizeLocale(body.resolvedLocale);
  const otp = String(body.otp ?? "").trim();
  if (!/^\d{6}$/.test(otp)) {
    throw new HttpError(
      400,
      "invalid_otp_format",
      "Verification code must be 6 digits.",
    );
  }

  const admin = createAdminClient();
  const normalizedEmail = normalizeEmail(context.email);
  const { data: challenge, error: challengeError } = await admin
    .from("account_email_otp_challenges")
    .select("id,otp_hash,expires_at,attempts,max_attempts")
    .eq("user_id", context.userId)
    .eq("purpose", OTP_PURPOSE)
    .eq("normalized_email", normalizedEmail)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (challengeError) throw challengeError;
  if (!challenge) {
    throw new HttpError(
      400,
      "otp_not_found",
      "No active verification code was found.",
    );
  }
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    throw new HttpError(
      400,
      "otp_expired",
      "The verification code has expired.",
    );
  }
  if (challenge.attempts >= challenge.max_attempts) {
    throw new HttpError(
      429,
      "too_many_attempts",
      "Too many verification attempts.",
    );
  }

  const otpHash = await buildOtpHash({
    userId: context.userId,
    normalizedEmail,
    otp,
  });
  if (otpHash !== challenge.otp_hash) {
    await admin
      .from("account_email_otp_challenges")
      .update({ attempts: challenge.attempts + 1 })
      .eq("id", challenge.id);
    throw new HttpError(
      400,
      "invalid_otp",
      "The verification code is incorrect.",
    );
  }

  const now = new Date();
  const { data: consumed, error: consumeError } = await admin
    .from("account_email_otp_challenges")
    .update({ consumed_at: now.toISOString() })
    .eq("id", challenge.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (consumeError) throw consumeError;
  if (!consumed) {
    throw new HttpError(
      409,
      "otp_already_used",
      "The verification code was already used.",
    );
  }

  const { data: deletionRequest, error: requestError } = await admin
    .from("account_deletion_requests")
    .insert({
      user_id: context.userId,
      normalized_login_email: normalizedEmail,
      resolved_locale: locale,
      status: "preparing",
      otp_verified_at: now.toISOString(),
    })
    .select("id,scheduled_deletion_at")
    .single();
  if (requestError) throw requestError;
  const scheduledDeletionAt = String(deletionRequest.scheduled_deletion_at);

  let delivery: { destinationCount: number; deliveredCount: number };
  try {
    delivery = await sendRecoveryCode({
      requestId: deletionRequest.id,
      userId: context.userId,
      loginEmail: context.email,
      locale,
      scheduledDeletionAt,
    });
  } catch (error) {
    await admin
      .from("account_deletion_requests")
      .delete()
      .eq("id", deletionRequest.id);
    throw error;
  }

  const { error: activateError } = await admin
    .from("account_deletion_requests")
    .update({ status: "pending" })
    .eq("id", deletionRequest.id)
    .eq("status", "preparing");
  if (activateError) {
    await admin
      .from("account_deletion_requests")
      .delete()
      .eq("id", deletionRequest.id);
    throw activateError;
  }

  const { error: banError } = await admin.auth.admin.updateUserById(
    context.userId,
    { ban_duration: LONG_BAN_DURATION },
  );
  if (banError) {
    await admin
      .from("account_deletion_requests")
      .delete()
      .eq("id", deletionRequest.id)
      .eq("status", "pending");
    throw banError;
  }

  const { error: signOutError } = await admin.auth.admin.signOut(
    context.accessToken,
    "global",
  );
  if (signOutError) {
    console.warn(
      "Could not revoke all sessions after scheduling deletion",
      signOutError,
    );
  }

  return json({
    status: "scheduled",
    scheduledDeletionAt,
    recoveryCodeDeliveredTo: delivery.deliveredCount,
    recoveryDestinationCount: delivery.destinationCount,
  });
}

async function recordRecoveryFailure(request: DeletionRequest) {
  const admin = createAdminClient();
  const nextAttempts = request.recovery_failed_attempts + 1;
  const shouldLock = nextAttempts >= RECOVERY_FAILURE_LIMIT;
  const { error } = await admin
    .from("account_deletion_requests")
    .update({
      recovery_failed_attempts: shouldLock ? 0 : nextAttempts,
      recovery_locked_until: shouldLock
        ? new Date(Date.now() + RECOVERY_LOCK_MINUTES * 60 * 1000).toISOString()
        : null,
    })
    .eq("id", request.id)
    .eq("status", "pending");
  if (error) console.warn("Could not record account recovery failure", error);
}

async function findPendingRequestByEmail(email: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("account_deletion_requests")
    .select(
      "id,user_id,normalized_login_email,resolved_locale,status,scheduled_deletion_at,recovery_failed_attempts,recovery_locked_until",
    )
    .eq("normalized_login_email", normalizeEmail(email))
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  return data as DeletionRequest | null;
}

async function restoreAccount(body: RequestBody) {
  const email = normalizeEmail(body.email);
  const recoveryCode = normalizeRecoveryCode(body.recoveryCode);
  if (!email || recoveryCode.length < 34) {
    throw new HttpError(
      400,
      "invalid_recovery_input",
      "Email and recovery code are required.",
    );
  }

  const request = await findPendingRequestByEmail(email);
  if (!request) {
    throw new HttpError(
      400,
      "invalid_recovery_code",
      "The recovery information is invalid.",
    );
  }
  if (
    request.recovery_locked_until &&
    new Date(request.recovery_locked_until).getTime() > Date.now()
  ) {
    throw new HttpError(
      400,
      "invalid_recovery_code",
      "The recovery information is invalid.",
    );
  }

  const admin = createAdminClient();
  const codeHash = await buildRecoveryCodeHash(request.user_id, recoveryCode);
  const { data: codeRow, error: codeError } = await admin
    .from("account_deletion_recovery_codes")
    .select("id")
    .eq("request_id", request.id)
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .maybeSingle();
  if (codeError) throw codeError;
  if (!codeRow) {
    await recordRecoveryFailure(request);
    throw new HttpError(
      400,
      "invalid_recovery_code",
      "The recovery information is invalid.",
    );
  }
  if (new Date(request.scheduled_deletion_at).getTime() <= Date.now()) {
    throw new HttpError(
      410,
      "recovery_expired",
      "The account recovery period has ended.",
    );
  }

  const { data: claimed, error: claimError } = await admin
    .from("account_deletion_requests")
    .update({ status: "restoring" })
    .eq("id", request.id)
    .eq("status", "pending")
    .gt("scheduled_deletion_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    throw new HttpError(
      409,
      "recovery_unavailable",
      "Account recovery is no longer available.",
    );
  }

  const { error: unbanError } = await admin.auth.admin.updateUserById(
    request.user_id,
    { ban_duration: "none" },
  );
  if (unbanError) {
    await admin
      .from("account_deletion_requests")
      .update({ status: "pending" })
      .eq("id", request.id)
      .eq("status", "restoring");
    throw unbanError;
  }

  await admin
    .from("account_deletion_recovery_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", codeRow.id);
  const { error: deleteError } = await admin
    .from("account_deletion_requests")
    .delete()
    .eq("id", request.id)
    .eq("status", "restoring");
  if (deleteError) {
    await admin.auth.admin.updateUserById(request.user_id, {
      ban_duration: LONG_BAN_DURATION,
    });
    await admin
      .from("account_deletion_requests")
      .update({ status: "pending" })
      .eq("id", request.id);
    throw deleteError;
  }

  return json({ status: "restored" });
}

async function resendRecoveryCode(body: RequestBody) {
  const email = normalizeEmail(body.email);
  if (!email) {
    throw new HttpError(400, "email_required", "Email is required.");
  }

  const accepted = () => json({ status: "accepted" }, 202);
  const request = await findPendingRequestByEmail(email);
  if (
    !request || new Date(request.scheduled_deletion_at).getTime() <= Date.now()
  ) {
    return accepted();
  }

  const admin = createAdminClient();
  const resendWindowStart = new Date(
    Date.now() - RECOVERY_RESEND_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();
  const [
    { count: recentCount, error: recentError },
    { count: totalCount, error: totalError },
  ] = await Promise.all([
    admin
      .from("account_deletion_recovery_codes")
      .select("id", { count: "exact", head: true })
      .eq("request_id", request.id)
      .gte("created_at", resendWindowStart),
    admin
      .from("account_deletion_recovery_codes")
      .select("id", { count: "exact", head: true })
      .eq("request_id", request.id),
  ]);
  if (recentError || totalError) throw recentError ?? totalError;
  if ((recentCount ?? 0) >= 1 || (totalCount ?? 0) >= RECOVERY_CODE_LIMIT) {
    return accepted();
  }

  const { data: userData, error: userError } = await admin.auth.admin
    .getUserById(
      request.user_id,
    );
  if (userError || !userData.user?.email) return accepted();

  try {
    await sendRecoveryCode({
      requestId: request.id,
      userId: request.user_id,
      loginEmail: userData.user.email,
      locale: request.resolved_locale,
      scheduledDeletionAt: request.scheduled_deletion_at,
    });
  } catch (error) {
    console.error("Could not resend account recovery code", error);
  }
  return accepted();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
    }
    const body = (await req.json()) as RequestBody;
    switch (body.action) {
      case "start_deletion":
        return await startDeletion(req, body);
      case "confirm_deletion":
        return await confirmDeletion(req, body);
      case "restore_account":
        return await restoreAccount(body);
      case "resend_recovery_code":
        return await resendRecoveryCode(body);
      default:
        throw new HttpError(400, "unknown_action", "Unknown action");
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.code, message: error.message }, error.status);
    }
    console.error("account-deletion failed", error);
    return json(
      {
        error: "internal_error",
        message: "Could not complete the account deletion procedure.",
      },
      500,
    );
  }
});
