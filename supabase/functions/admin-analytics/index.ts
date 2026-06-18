import { createClient } from "npm:@supabase/supabase-js@2";

type Action = "status" | "summary";

type RequestBody = {
  action?: Action;
};

type AuthUser = {
  id: string;
  email?: string;
};

type AppEventRow = {
  event_name: string;
  user_id: string | null;
  anonymous_id: string | null;
  created_at: string;
};

type CountValue = number | null;

class AdminAnalyticsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminAnalyticsConfigError";
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EVENT_NAMES = [
  "memo_saved",
  "memo_created",
  "memo_updated",
  "explorer_opened",
  "dust_opened",
  "search_used",
  "feedback_sent",
  "auth_signin_succeeded",
] as const;

const PAGE_SIZE = 1000;
const MAX_RECENT_EVENTS = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

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
  if (!value) throw new AdminAnalyticsConfigError(`${name} is required`);
  return value;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function getAdminEmailSet() {
  const raw = requiredEnv("ADMIN_EMAILS");
  const emails = raw
    .split(/[,\s]+/)
    .map(normalizeEmail)
    .filter(Boolean);

  if (emails.length === 0) {
    throw new AdminAnalyticsConfigError("ADMIN_EMAILS must include at least one email");
  }

  return new Set(emails);
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

  throw new AdminAnalyticsConfigError(
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
    throw json({ error: "unauthorized", message: "Unauthorized" }, 401);
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
    throw json({ error: "unauthorized", message: "Unauthorized" }, 401);
  }

  return {
    id: data.user.id,
    email: data.user.email ?? undefined,
  };
}

async function requireAdminUser(req: Request) {
  const user = await getAuthenticatedUser(req);
  const email = normalizeEmail(user.email ?? "");

  if (!email || !getAdminEmailSet().has(email)) {
    throw json({ error: "forbidden", message: "Admin access is required." }, 403);
  }

  return user;
}

function parseAction(body: RequestBody): Action {
  return body.action === "status" ? "status" : "summary";
}

function startOfJstDay(now: Date) {
  const shifted = now.getTime() + JST_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - JST_OFFSET_MS);
}

function buildWindows(now: Date) {
  return [
    {
      key: "today",
      label: "Today",
      since: startOfJstDay(now),
    },
    {
      key: "last7d",
      label: "Last 7 days",
      since: new Date(now.getTime() - 7 * DAY_MS),
    },
    {
      key: "last30d",
      label: "Last 30 days",
      since: new Date(now.getTime() - 30 * DAY_MS),
    },
  ] as const;
}

function emptyEventCounts() {
  return Object.fromEntries(EVENT_NAMES.map((eventName) => [eventName, 0])) as Record<
    (typeof EVENT_NAMES)[number],
    number
  >;
}

function summarizeWindow(
  rows: AppEventRow[],
  window: ReturnType<typeof buildWindows>[number]
) {
  const sinceMs = window.since.getTime();
  const eventCounts = emptyEventCounts();
  const anonymousIds = new Set<string>();
  const userIds = new Set<string>();
  let totalEvents = 0;
  let authenticatedEvents = 0;

  for (const row of rows) {
    const createdAt = new Date(row.created_at).getTime();
    if (!Number.isFinite(createdAt) || createdAt < sinceMs) continue;

    totalEvents += 1;

    if (row.event_name in eventCounts) {
      eventCounts[row.event_name as keyof typeof eventCounts] += 1;
    }

    if (row.anonymous_id) anonymousIds.add(row.anonymous_id);

    if (row.user_id) {
      authenticatedEvents += 1;
      userIds.add(row.user_id);
    }
  }

  return {
    key: window.key,
    label: window.label,
    since: window.since.toISOString(),
    totalEvents,
    anonymousEvents: totalEvents - authenticatedEvents,
    authenticatedEvents,
    uniqueAnonymousVisitors: anonymousIds.size,
    uniqueAuthenticatedUsers: userIds.size,
    eventCounts,
  };
}

async function countRows(
  admin: ReturnType<typeof createAdminClient>,
  tableName: string,
  buildQuery?: (query: any) => any
): Promise<CountValue> {
  let query = admin.from(tableName).select("*", { count: "exact", head: true });
  if (buildQuery) query = buildQuery(query);

  const { count, error } = await query;
  if (error) {
    console.warn("[admin-analytics] count failed", tableName, error.message);
    return null;
  }

  return count ?? 0;
}

async function listRecentEvents(
  admin: ReturnType<typeof createAdminClient>,
  since: Date
) {
  const rows: AppEventRow[] = [];

  for (let from = 0; from < MAX_RECENT_EVENTS; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await admin
      .from("app_events")
      .select("event_name,user_id,anonymous_id,created_at")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const page = (data ?? []) as AppEventRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      return { rows, truncated: false };
    }
  }

  return { rows, truncated: true };
}

async function buildSummary() {
  const admin = createAdminClient();
  const now = new Date();
  const windows = buildWindows(now);
  const last30Days = windows[2].since;
  const recentEvents = await listRecentEvents(admin, last30Days);

  const [
    registeredUsers,
    activeMemos,
    trashedMemos,
    feedbackSubmissionsLast30d,
  ] = await Promise.all([
    countRows(admin, "profiles"),
    countRows(admin, "memos", (query) => query.is("deleted_at", null)),
    countRows(admin, "memos", (query) => query.not("deleted_at", "is", null)),
    countRows(admin, "feedback_submissions", (query) =>
      query.gte("created_at", last30Days.toISOString())
    ),
  ]);

  return {
    status: "ok",
    generatedAt: now.toISOString(),
    windows: windows.map((window) => summarizeWindow(recentEvents.rows, window)),
    totals: {
      registeredUsers,
      activeMemos,
      trashedMemos,
      feedbackSubmissionsLast30d,
    },
    notes: {
      recentEventRowsTruncated: recentEvents.truncated,
      recentEventRowsLimit: MAX_RECENT_EVENTS,
    },
  };
}

async function handleAdminAnalytics(req: Request) {
  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const action = parseAction(body);

  await requireAdminUser(req);

  if (action === "status") {
    return json({ status: "ok", isAdmin: true });
  }

  return json(await buildSummary());
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

    return await handleAdminAnalytics(req);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    if (error instanceof AdminAnalyticsConfigError) {
      console.error("admin-analytics configuration failed", error.message);

      return json(
        {
          error: "admin_analytics_configuration_error",
          message: `Admin analytics is not configured: ${error.message}`,
        },
        500
      );
    }

    console.error("admin-analytics failed", error);

    return json(
      {
        error: "internal_error",
        message: "Could not load admin analytics.",
      },
      500
    );
  }
});
