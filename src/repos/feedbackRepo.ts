import { supabase } from "../lib/supabaseClient";

export type FeedbackEnvironment = Record<string, string>;

export type SubmitFeedbackInput = {
  message: string;
  selectedText?: string;
  environment?: FeedbackEnvironment;
};

export type SubmitFeedbackResult = {
  status: "sent";
  message?: string;
};

class FeedbackSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackSubmissionError";
  }
}

async function readFunctionErrorMessage(error: unknown) {
  const fallback =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Could not send feedback. Please try again later.";

  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return fallback;

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
          : "";

    return message || fallback;
  } catch {
    return fallback;
  }
}

export async function submitFeedback(
  input: SubmitFeedbackInput
): Promise<SubmitFeedbackResult> {
  const { data, error } = await supabase.functions.invoke("send-feedback", {
    body: input,
  });

  if (error) {
    throw new FeedbackSubmissionError(await readFunctionErrorMessage(error));
  }

  const result = data as Partial<SubmitFeedbackResult> | null;
  if (result?.status !== "sent") {
    throw new FeedbackSubmissionError("Could not send feedback. Please try again later.");
  }

  return result as SubmitFeedbackResult;
}
