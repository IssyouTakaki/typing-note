import { supabase } from "../lib/supabaseClient";
import { trackPostHogEvent } from "./posthogAnalyticsRepo";

export type AppEventName =
  | "memo_saved"
  | "memo_created"
  | "memo_updated"
  | "explorer_opened"
  | "dust_opened"
  | "search_used"
  | "feedback_sent"
  | "auth_signin_succeeded";

type AppEventMetadata = {
  memo_saved: {
    result: "noop" | "created" | "updated" | "auth_required";
    trigger: "shortcut" | "auto_update";
  };
  memo_created: {
    trigger: "shortcut" | "auto_update";
  };
  memo_updated: {
    trigger: "shortcut" | "auto_update";
  };
  explorer_opened: {
    result: "opened" | "activated" | "auth_required";
    trigger: "button" | "shortcut_tab";
  };
  dust_opened: {
    result: "opened" | "activated" | "auth_required";
    trigger: "button" | "shortcut_tab";
  };
  search_used: {
    surface: "editor" | "explorer" | "dust";
    trigger: "shortcut" | "input";
  };
  feedback_sent: {
    included_selection: boolean;
    included_environment: boolean;
  };
  auth_signin_succeeded: {
    trigger: "password";
  };
};

type MetadataValue = string | number | boolean | null;

const ANONYMOUS_ID_KEY = "typingnote.analytics.anonymous_id";
const SESSION_ID_KEY = "typingnote.analytics.session_id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EVENT_METADATA_KEYS: Record<AppEventName, readonly string[]> = {
  memo_saved: ["result", "trigger"],
  memo_created: ["trigger"],
  memo_updated: ["trigger"],
  explorer_opened: ["result", "trigger"],
  dust_opened: ["result", "trigger"],
  search_used: ["surface", "trigger"],
  feedback_sent: ["included_selection", "included_environment"],
  auth_signin_succeeded: ["trigger"],
};

const STRING_VALUES_BY_KEY: Record<string, readonly string[]> = {
  result: ["noop", "created", "updated", "auth_required", "opened", "activated"],
  trigger: ["shortcut", "auto_update", "button", "shortcut_tab", "input", "password"],
  surface: ["editor", "explorer", "dust"],
};

let cachedAnonymousId: string | null = null;
let cachedSessionId: string | null = null;

function getStorage(kind: "local" | "session"): Storage | undefined {
  try {
    return kind === "local" ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function createUuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function readStoredUuid(storage: Storage | undefined, key: string) {
  if (!storage) return null;

  try {
    const value = storage.getItem(key);
    return value && UUID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredUuid(storage: Storage | undefined, key: string, value: string) {
  if (!storage) return;

  try {
    storage.setItem(key, value);
  } catch {
    // Analytics must never break the editor.
  }
}

function getAnonymousId() {
  if (cachedAnonymousId) return cachedAnonymousId;

  const storage = getStorage("local");
  const stored = readStoredUuid(storage, ANONYMOUS_ID_KEY);
  cachedAnonymousId = stored ?? createUuid();
  if (!stored) {
    writeStoredUuid(storage, ANONYMOUS_ID_KEY, cachedAnonymousId);
  }

  return cachedAnonymousId;
}

function getSessionId() {
  if (cachedSessionId) return cachedSessionId;

  const storage = getStorage("session");
  const stored = readStoredUuid(storage, SESSION_ID_KEY);
  cachedSessionId = stored ?? createUuid();
  if (!stored) {
    writeStoredUuid(storage, SESSION_ID_KEY, cachedSessionId);
  }

  return cachedSessionId;
}

function getPagePath() {
  try {
    return globalThis.location?.pathname?.slice(0, 200) || "/";
  } catch {
    return "/";
  }
}

function sanitizeMetadata(
  eventName: AppEventName,
  metadata: Record<string, unknown>
): Record<string, MetadataValue> {
  const clean: Record<string, MetadataValue> = {};

  for (const key of EVENT_METADATA_KEYS[eventName]) {
    const value = metadata[key];

    if (typeof value === "string") {
      const allowedValues = STRING_VALUES_BY_KEY[key] ?? [];
      if (allowedValues.includes(value)) {
        clean[key] = value;
      }
      continue;
    }

    if (typeof value === "boolean") {
      clean[key] = value;
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = Math.round(value);
      continue;
    }

    if (value === null) {
      clean[key] = null;
    }
  }

  return clean;
}

async function insertEvent<Name extends AppEventName>(
  eventName: Name,
  metadata: AppEventMetadata[Name]
) {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const userId = data.session?.user.id ?? null;
  const anonymousId = getAnonymousId();
  const sessionId = getSessionId();
  const pagePath = getPagePath();
  const cleanMetadata = sanitizeMetadata(eventName, metadata);

  const { error } = await supabase.from("app_events").insert({
    user_id: userId,
    anonymous_id: anonymousId,
    session_id: sessionId,
    event_name: eventName,
    metadata: cleanMetadata,
    page_path: pagePath,
  });

  if (error) throw error;

  trackPostHogEvent({
    eventName,
    metadata: cleanMetadata,
    anonymousId,
    userId,
    pagePath,
  });
}

export function trackEvent<Name extends AppEventName>(
  eventName: Name,
  metadata: AppEventMetadata[Name]
): void {
  void insertEvent(eventName, metadata).catch((error) => {
    console.warn("[analytics] failed to track event", eventName, error);
  });
}
