import { supabase } from "../lib/supabaseClient";

export type AdminAnalyticsEventName =
  | "memo_saved"
  | "memo_created"
  | "memo_updated"
  | "explorer_opened"
  | "dust_opened"
  | "search_used"
  | "feedback_sent"
  | "auth_signin_succeeded";

export type AdminAnalyticsWindowKey = "today" | "last7d" | "last30d";

export type AdminAnalyticsWindow = {
  key: AdminAnalyticsWindowKey;
  label: string;
  since: string;
  totalEvents: number;
  anonymousEvents: number;
  authenticatedEvents: number;
  uniqueAnonymousVisitors: number;
  uniqueAuthenticatedUsers: number;
  eventCounts: Record<AdminAnalyticsEventName, number>;
};

export type AdminAnalyticsSummary = {
  status: "ok";
  generatedAt: string;
  windows: AdminAnalyticsWindow[];
  totals: {
    registeredUsers: number | null;
    activeMemos: number | null;
    trashedMemos: number | null;
    feedbackSubmissionsLast30d: number | null;
  };
  notes: {
    recentEventRowsTruncated: boolean;
    recentEventRowsLimit: number;
  };
};

class AdminAnalyticsError extends Error {
  status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "AdminAnalyticsError";
    this.status = status;
  }
}

async function readFunctionError(error: unknown) {
  const fallback =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Could not load admin analytics.";

  const context = (error as { context?: unknown } | null)?.context;
  const status = context instanceof Response ? context.status : null;

  if (!(context instanceof Response)) {
    return { message: fallback, status };
  }

  try {
    const payload = (await context.clone().json()) as {
      message?: unknown;
      error?: unknown;
    };

    const message =
      typeof payload.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : typeof payload.error === "string" && payload.error.trim()
          ? payload.error.trim()
          : fallback;

    return { message, status };
  } catch {
    return { message: fallback, status };
  }
}

async function invokeAdminAnalytics<T>(body: { action: "status" | "summary" }) {
  const { data, error } = await supabase.functions.invoke("admin-analytics", {
    body,
  });

  if (error) {
    const details = await readFunctionError(error);
    throw new AdminAnalyticsError(details.message, details.status);
  }

  return data as T;
}

export async function isAdminAnalyticsAvailable(): Promise<boolean> {
  try {
    const result = await invokeAdminAnalytics<{ status: "ok"; isAdmin: boolean }>({
      action: "status",
    });

    return result.status === "ok" && result.isAdmin === true;
  } catch (error) {
    if (
      error instanceof AdminAnalyticsError &&
      (error.status === 401 || error.status === 403)
    ) {
      return false;
    }

    console.warn("[admin] failed to check admin analytics access", error);
    return false;
  }
}

export async function getAdminAnalyticsSummary(): Promise<AdminAnalyticsSummary> {
  const result = await invokeAdminAnalytics<AdminAnalyticsSummary>({
    action: "summary",
  });

  if (result?.status !== "ok" || !Array.isArray(result.windows)) {
    throw new AdminAnalyticsError("Could not load admin analytics.", null);
  }

  return result;
}

export function formatAdminAnalyticsError(error: unknown) {
  if (error instanceof AdminAnalyticsError && error.message.trim()) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Could not load admin analytics.";
}
