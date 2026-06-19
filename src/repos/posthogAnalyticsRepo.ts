import posthog from "posthog-js/dist/module.no-external";
import type { AppEventName } from "./analyticsRepo";

type PostHogProperties = Record<string, string | number | boolean | null>;
type PostHogExceptionProperties = Record<string, unknown>;

type PostHogEventInput = {
  eventName: AppEventName;
  metadata: PostHogProperties;
  anonymousId: string;
  userId: string | null;
  pagePath: string;
};

type PostHogIdentityInput = {
  anonymousId: string;
  userId: string | null;
};

type PostHogExceptionSource = "window_error" | "unhandledrejection";

const ALLOWED_POSTHOG_PROPERTY_KEYS = new Set([
  "token",
  "app",
  "page_path",
  "typingnote_subject_id",
  "typingnote_subject_kind",
  "exception_source",
  "exception_filename",
  "exception_lineno",
  "exception_colno",
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
let currentAnonymousId: string | null = null;
let currentUserId: string | null = null;
let manualExceptionCaptureInstalled = false;

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

function filterPostHogExceptionProperties(properties: unknown) {
  const clean: PostHogExceptionProperties = {};
  if (!properties || typeof properties !== "object") return clean;

  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    if (ALLOWED_POSTHOG_PROPERTY_KEYS.has(key) || key.startsWith("$exception")) {
      clean[key] = value;
    }
  }

  return clean;
}

function getCurrentPagePath() {
  try {
    return globalThis.location?.pathname?.slice(0, 200) || "/";
  } catch {
    return "/";
  }
}

function getTypingNoteProperties(pagePath = getCurrentPagePath()): PostHogProperties {
  return {
    app: "typing-note",
    page_path: pagePath,
    typingnote_subject_id: currentUserId ?? currentAnonymousId,
    typingnote_subject_kind: currentUserId ? "authenticated" : "anonymous",
  };
}

function numberOrNull(value: number) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function toErrorLike(value: unknown, fallbackMessage: string) {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.trim()) return new Error(value);
  return new Error(fallbackMessage);
}

function capturePostHogException(
  error: unknown,
  metadata: PostHogProperties & { exception_source: PostHogExceptionSource }
) {
  try {
    posthog.captureException(error, {
      ...getTypingNoteProperties(),
      ...metadata,
    });
  } catch (captureError) {
    console.warn("[posthog] failed to capture exception", captureError);
  }
}

function installManualExceptionCapture() {
  if (manualExceptionCaptureInstalled) return;
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    capturePostHogException(
      event.error ?? toErrorLike(event.message, "Unhandled window error"),
      {
        exception_source: "window_error",
        exception_filename: event.filename || null,
        exception_lineno: numberOrNull(event.lineno),
        exception_colno: numberOrNull(event.colno),
      }
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    capturePostHogException(
      toErrorLike(event.reason, "Unhandled promise rejection"),
      {
        exception_source: "unhandledrejection",
        exception_filename: null,
        exception_lineno: null,
        exception_colno: null,
      }
    );
  });

  manualExceptionCaptureInstalled = true;
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
      if (event.event === "$exception") {
        event.properties = filterPostHogExceptionProperties({
          ...event.properties,
          ...getTypingNoteProperties(),
        });
        return event;
      }

      if (event.event.startsWith("$")) return null;
      event.properties = filterPostHogProperties(event.properties);
      return event;
    },
  });

  initialized = true;
  currentDistinctId = anonymousId;
  currentAnonymousId = anonymousId;
  installManualExceptionCapture();
  return true;
}

function syncDistinctId(userId: string | null, anonymousId: string) {
  currentUserId = userId;
  currentAnonymousId = anonymousId;

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

function configurePostHogIdentity(userId: string | null, anonymousId: string) {
  if (!initPostHog(anonymousId)) return false;

  syncDistinctId(userId, anonymousId);
  return true;
}

export function configurePostHog(input: PostHogIdentityInput): void {
  try {
    configurePostHogIdentity(input.userId, input.anonymousId);
  } catch (error) {
    console.warn("[posthog] failed to configure", error);
  }
}

export function trackPostHogEvent(input: PostHogEventInput): void {
  try {
    if (!configurePostHogIdentity(input.userId, input.anonymousId)) return;

    posthog.capture(input.eventName, {
      ...input.metadata,
      ...getTypingNoteProperties(input.pagePath),
    });
  } catch (error) {
    console.warn("[posthog] failed to track event", input.eventName, error);
  }
}
