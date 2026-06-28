// deno-lint-ignore no-import-prefix
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_PURGES_PER_RUN = 50;

type ResolvedLocale = "ja" | "en";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeLocale(value: unknown): ResolvedLocale {
  return value === "ja" ? "ja" : "en";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char] ?? char);
}

function createAdminClient() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
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

function buildDeletionCompletedMessage(
  email: string,
  completedAt: string,
  locale: ResolvedLocale,
) {
  const safeEmail = escapeHtml(email);
  const safeCompletedAt = escapeHtml(completedAt);

  if (locale === "ja") {
    return {
      subject: "TypingNote アカウント削除完了のお知らせ",
      text: [
        "TypingNote アカウントの削除が完了しました。",
        "",
        `対象メール: ${email}`,
        `削除完了日時: ${completedAt}`,
        "",
        "30日間の復元期間が終了したため、このアカウントは復元できません。",
        "このメールは、削除完了後に自動送信されています。",
      ].join("\n"),
      html: `
        <p>TypingNote アカウントの削除が完了しました。</p>
        <p>対象メール: <strong>${safeEmail}</strong></p>
        <p>削除完了日時: <strong>${safeCompletedAt}</strong></p>
        <p>30日間の復元期間が終了したため、このアカウントは復元できません。</p>
        <p>このメールは、削除完了後に自動送信されています。</p>
      `,
    };
  }

  return {
    subject: "Your TypingNote account has been deleted",
    text: [
      "Your TypingNote account has been permanently deleted.",
      "",
      `Account email: ${email}`,
      `Completed at: ${completedAt}`,
      "",
      "The 30-day recovery period has ended, so this account can no longer be restored.",
      "This email was sent automatically after deletion completed.",
    ].join("\n"),
    html: `
      <p>Your TypingNote account has been permanently deleted.</p>
      <p>Account email: <strong>${safeEmail}</strong></p>
      <p>Completed at: <strong>${safeCompletedAt}</strong></p>
      <p>The 30-day recovery period has ended, so this account can no longer be restored.</p>
      <p>This email was sent automatically after deletion completed.</p>
    `,
  };
}

async function sendDeletionCompletedEmail(args: {
  to: string;
  locale: ResolvedLocale;
  completedAt: string;
}) {
  await sendEmail({
    to: args.to,
    ...buildDeletionCompletedMessage(args.to, args.completedAt, args.locale),
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const expected = `Bearer ${requiredEnv("PURGE_ACCOUNT_DELETIONS_TOKEN")}`;
  if (req.headers.get("Authorization") !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: dueRequests, error: dueError } = await admin
    .from("account_deletion_requests")
    .select("id,user_id,normalized_login_email,resolved_locale")
    .eq("status", "pending")
    .lte("scheduled_deletion_at", now)
    .order("scheduled_deletion_at", { ascending: true })
    .limit(MAX_PURGES_PER_RUN);

  if (dueError) {
    console.error("Could not list due account deletions", dueError);
    return json({ error: "Could not list due account deletions" }, 500);
  }

  let deleted = 0;
  let notified = 0;
  const failed: string[] = [];
  const notificationFailed: string[] = [];

  for (const request of dueRequests ?? []) {
    const { data: claimed, error: claimError } = await admin
      .from("account_deletion_requests")
      .update({ status: "purging" })
      .eq("id", request.id)
      .eq("status", "pending")
      .lte("scheduled_deletion_at", now)
      .select("id")
      .maybeSingle();

    if (claimError || !claimed) {
      if (claimError) {
        console.warn("Could not claim account deletion", claimError);
      }
      continue;
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(
      request.user_id,
      false,
    );
    if (!deleteError) {
      deleted += 1;
      const email = String(request.normalized_login_email ?? "").trim();
      if (!email) {
        notificationFailed.push(request.id);
        console.error(
          "Could not send deletion completion email: missing email",
        );
        continue;
      }

      try {
        await sendDeletionCompletedEmail({
          to: email,
          locale: normalizeLocale(request.resolved_locale),
          completedAt: now,
        });
        notified += 1;
      } catch (error) {
        notificationFailed.push(request.id);
        console.error(
          "Could not send deletion completion email",
          request.id,
          error,
        );
      }
      continue;
    }

    failed.push(request.id);
    console.error("Could not purge Auth user", request.user_id, deleteError);
    const { error: releaseError } = await admin
      .from("account_deletion_requests")
      .update({ status: "pending" })
      .eq("id", request.id)
      .eq("status", "purging");
    if (releaseError) {
      console.error("Could not release purge claim", releaseError);
    }
  }

  return json({
    status: failed.length ? "partial" : "ok",
    examined: dueRequests?.length ?? 0,
    deleted,
    notified,
    failed,
    notificationFailed,
  });
});
