// deno-lint-ignore no-import-prefix
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_PURGES_PER_RUN = 50;

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

function createAdminClient() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
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
    .select("id,user_id")
    .eq("status", "pending")
    .lte("scheduled_deletion_at", now)
    .order("scheduled_deletion_at", { ascending: true })
    .limit(MAX_PURGES_PER_RUN);

  if (dueError) {
    console.error("Could not list due account deletions", dueError);
    return json({ error: "Could not list due account deletions" }, 500);
  }

  let deleted = 0;
  const failed: string[] = [];

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
    failed,
  });
});
