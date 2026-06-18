import posthog from "posthog-js/dist/module.no-external";
import type { AppEventName } from "./analyticsRepo";

type PostHogProperties = Record<string, string | number | boolean | null>;

type PostHogEventInput = {
  eventName: AppEventName;
  metadata: PostHogProperties;
  anonymousId: string;
  userId: string | null;
  pagePath: string;
};

const ALLOWED_POSTHOG_PROPERTY_KEYS = new Set([
  "app",
  "page_path",
  "typingnote_subject_id",
  "typingnote_subject_kind",
  "result",
  "trigger",
  "surface",
  "included_selection",
  "included_environment",
  "distinct_id",
]);

const POSTHOG_ENABLED = import.meta.env.VITE_POSTHOG_ENABLED === "true";
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined)
  ?.trim()
  .replace(/\/+$/, "");

let initialized = false;
let disabledLogged = false;
let currentDistinctId: string | null = null;

function canUsePostHog() {
  return POSTHOG_ENABLED && !!POSTHOG_KEY?.trim() && !!POSTHOG_HOST;
}

function logDisabledOnce() {
  if (disabledLogged) return;
  disabledLogged = true;
  console.info("[posthog] disabled or not configured");
}

function filterPostHogProperties(properties: unknown) {
  const clean: PostHogProperties = {};
  if (!properties || typeof properties !== "object") return clean;

  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    if (!ALLOWED_POSTHOG_PROPERTY_KEYS.has(key)) continue;

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      clean[key] = value;
    }
  }

  return clean;
}

function initPostHog(anonymousId: string) {
  if (initialized) return true;

  if (!canUsePostHog()) {
    logDisabledOnce();
    return false;
  }

  posthog.init(POSTHOG_KEY!.trim(), {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_web_experiments: true,
    enable_recording_console_log: false,
    logs: {
      captureConsoleLogs: false,
      beforeSend: () => null,
    },
    advanced_disable_feature_flags: true,
    advanced_disable_feature_flags_on_first_load: true,
    advanced_disable_toolbar_metrics: true,
    person_profiles: "identified_only",
    bootstrap: {
      distinctID: anonymousId,
      isIdentifiedID: false,
    },
    before_send: (event) => {
      if (!event) return null;
      if (event.event.startsWith("$")) return null;
      event.properties = filterPostHogProperties(event.properties);
      return event;
    },
  });

  initialized = true;
  currentDistinctId = anonymousId;
  return true;
}

function syncDistinctId(userId: string | null, anonymousId: string) {
  const nextDistinctId = userId ?? anonymousId;
  if (currentDistinctId === nextDistinctId) return;

  if (userId) {
    posthog.identify(userId);
  } else {
    posthog.reset();
    posthog.register({ distinct_id: anonymousId });
  }

  currentDistinctId = nextDistinctId;
}

export function trackPostHogEvent(input: PostHogEventInput): void {
  try {
    if (!initPostHog(input.anonymousId)) return;

    syncDistinctId(input.userId, input.anonymousId);

    posthog.capture(input.eventName, {
      ...input.metadata,
      app: "typing-note",
      page_path: input.pagePath,
      typingnote_subject_id: input.userId ?? input.anonymousId,
      typingnote_subject_kind: input.userId ? "authenticated" : "anonymous",
    });
  } catch (error) {
    console.warn("[posthog] failed to track event", input.eventName, error);
  }
}
