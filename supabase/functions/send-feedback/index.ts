import { createClient } from "npm:@supabase/supabase-js@2";

type AuthUser = {
  id: string;
  email?: string;
};

type FeedbackBody = {
  message?: string;
  selectedText?: string;
  environment?: Record<string, unknown>;
};

class FeedbackConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackConfigError";
  }
}

class FeedbackDatabaseSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackDatabaseSetupError";
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MESSAGE_MAX_LENGTH = 4000;
const SELECTED_TEXT_MAX_LENGTH = 2000;
const RATE_LIMIT_WINDOW_MINUTES = 15;
const RATE_LIMIT_WINDOW_COUNT = 3;
const DAILY_LIMIT_COUNT = 20;

const ENVIRONMENT_KEYS = [
  "appScreen",
  "view",
  "activeTabMode",
  "hasSavedMemo",
  "viewport",
  "screen",
  "language",
  "languages",
  "platform",
  "timezone",
  "url",
  "userAgent",
];

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
  if (!value) throw new FeedbackConfigError(`${name} is required`);
  return value;
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

  throw new FeedbackConfigError(
    "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS is required"
  );
}

function createAdminClient() {
  return createClient(requiredEnv("SUPABASE_URL"), getServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function getAuthenticatedUser(req: Request): Promise<AuthUser> {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const userClient = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_ANON_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    }
  );

  const { data, error } = await userClient.auth.getUser();

  if (error || !data.user) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  const { data: deletionRequest, error: deletionRequestError } = await admin
    .from("account_deletion_requests")
    .select("id")
    .eq("user_id", data.user.id)
    .in("status", ["pending", "restoring", "purging"])
    .maybeSingle();

  if (deletionRequestError) throw deletionRequestError;
  if (deletionRequest) {
    throw json(
      {
        error: "account_pending_deletion",
        message: "Account access is disabled while deletion is pending.",
      },
      423
    );
  }

  return {
    id: data.user.id,
    email: data.user.email ?? undefined,
  };
}

function countChars(value: string) {
  return Array.from(value).length;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function sanitizeLine(value: string, maxLength: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxLength);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeEnvironment(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, string> = {};

  for (const key of ENVIRONMENT_KEYS) {
    const raw = source[key];
    if (raw == null) continue;

    const text = sanitizeLine(String(raw), key === "userAgent" ? 1000 : 300);
    if (text) result[key] = text;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function assertFeedbackDatabaseReady(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : String(error ?? "");

  if (
    message.includes("feedback_submissions") &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("relation"))
  ) {
    throw new FeedbackDatabaseSetupError(
      "Feedback database table is not ready. Apply the feedback_submissions migration."
    );
  }
}

async function countSubmissionsSince(args: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  since: string;
}) {
  const { count, error } = await args.admin
    .from("feedback_submissions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", args.userId)
    .gte("created_at", args.since);

  if (error) {
    assertFeedbackDatabaseReady(error);
    throw error;
  }
  return count ?? 0;
}

async function enforceRateLimits(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
) {
  const windowStart = new Date(
    Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  const dailyStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const recentCount = await countSubmissionsSince({
    admin,
    userId,
    since: windowStart,
  });

  if (recentCount >= RATE_LIMIT_WINDOW_COUNT) {
    return json(
      {
        error: "too_many_feedback_requests",
        message: `Feedback can be sent up to ${RATE_LIMIT_WINDOW_COUNT} times every ${RATE_LIMIT_WINDOW_MINUTES} minutes.`,
      },
      429
    );
  }

  const dailyCount = await countSubmissionsSince({
    admin,
    userId,
    since: dailyStart,
  });

  if (dailyCount >= DAILY_LIMIT_COUNT) {
    return json(
      {
        error: "daily_feedback_limit_reached",
        message: `Feedback can be sent up to ${DAILY_LIMIT_COUNT} times per 24 hours.`,
      },
      429
    );
  }

  return null;
}

function buildFeedbackEmail(args: {
  user: AuthUser;
  message: string;
  selectedText: string;
  environment: Record<string, string> | null;
}) {
  const identity = sanitizeLine(args.user.email ?? args.user.id, 80);
  const subject = `[TypingNote Feedback] ${identity}`;

  const environmentText = args.environment
    ? Object.entries(args.environment)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n")
    : "";

  const text = [
    "TypingNote feedback",
    "",
    "User",
    `userId: ${args.user.id}`,
    `email: ${args.user.email ?? "(none)"}`,
    "",
    "Message",
    args.message,
    "",
    args.selectedText ? "Selected text" : "",
    args.selectedText,
    "",
    environmentText ? "Environment" : "",
    environmentText,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #222;">
      <h1 style="font-size: 18px;">TypingNote feedback</h1>
      <h2 style="font-size: 14px;">User</h2>
      <p><strong>userId:</strong> ${escapeHtml(args.user.id)}<br>
      <strong>email:</strong> ${escapeHtml(args.user.email ?? "(none)")}</p>
      <h2 style="font-size: 14px;">Message</h2>
      <pre style="white-space: pre-wrap; font: inherit;">${escapeHtml(args.message)}</pre>
      ${
        args.selectedText
          ? `<h2 style="font-size: 14px;">Selected text</h2>
             <pre style="white-space: pre-wrap; font: inherit;">${escapeHtml(args.selectedText)}</pre>`
          : ""
      }
      ${
        environmentText
          ? `<h2 style="font-size: 14px;">Environment</h2>
             <pre style="white-space: pre-wrap; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;">${escapeHtml(environmentText)}</pre>`
          : ""
      }
    </div>
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

async function handleFeedback(req: Request) {
  const user = await getAuthenticatedUser(req);
  const body = (await req.json()) as FeedbackBody;
  const feedbackMailTo = requiredEnv("FEEDBACK_MAIL_TO");

  const message = normalizeText(body.message);
  const selectedText = normalizeText(body.selectedText);
  const environment = sanitizeEnvironment(body.environment);

  if (!message) {
    return json({ error: "message_required", message: "Feedback message is required." }, 400);
  }

  if (countChars(message) > MESSAGE_MAX_LENGTH) {
    return json(
      {
        error: "message_too_long",
        message: `Feedback message must be ${MESSAGE_MAX_LENGTH} characters or fewer.`,
      },
      400
    );
  }

  if (countChars(selectedText) > SELECTED_TEXT_MAX_LENGTH) {
    return json(
      {
        error: "selected_text_too_long",
        message: `Selected text must be ${SELECTED_TEXT_MAX_LENGTH} characters or fewer.`,
      },
      400
    );
  }

  const admin = createAdminClient();
  const rateLimitResponse = await enforceRateLimits(admin, user.id);
  if (rateLimitResponse) return rateLimitResponse;

  const { error: insertError } = await admin
    .from("feedback_submissions")
    .insert({
      user_id: user.id,
      login_email: user.email ?? null,
      message_length: countChars(message),
      selected_text_length: countChars(selectedText),
      included_selection: Boolean(selectedText),
      included_environment: Boolean(environment),
    });

  if (insertError) {
    assertFeedbackDatabaseReady(insertError);
    throw insertError;
  }

  const email = buildFeedbackEmail({
    user,
    message,
    selectedText,
    environment,
  });

  await sendEmail({
    to: feedbackMailTo,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });

  return json({
    status: "sent",
    message: "Feedback sent.",
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

    return await handleFeedback(req);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    if (error instanceof FeedbackConfigError) {
      console.error("send-feedback configuration failed", error.message);

      return json(
        {
          error: "feedback_configuration_error",
          message: `Feedback is not configured: ${error.message}`,
        },
        500
      );
    }

    if (error instanceof FeedbackDatabaseSetupError) {
      console.error("send-feedback database setup failed", error.message);

      return json(
        {
          error: "feedback_database_setup_error",
          message: error.message,
        },
        500
      );
    }

    console.error("send-feedback failed", error);

    return json(
      {
        error: "internal_error",
        message: "Could not send feedback. Please try again later.",
      },
      500
    );
  }
});
