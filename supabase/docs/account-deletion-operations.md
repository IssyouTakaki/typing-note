# Account Deletion Operations

This runbook covers the server configuration required by the recoverable
account deletion flow. Never commit secret values.

## Apply and deploy

1. Review and apply `supabase/migrations/20260622_account_deletion.sql`.
2. Add a strong random `ACCOUNT_RECOVERY_PEPPER` Edge Function secret.
3. Deploy `account-deletion`.
4. Add a strong random `PURGE_ACCOUNT_DELETIONS_TOKEN` Edge Function secret.
5. Store the same purge token in Supabase Vault for the Cron job.
6. Deploy `purge-account-deletions` with JWT verification disabled. The
   function validates the purge token itself.
7. Exercise the full flow with a disposable user before enabling the UI in
   production.

The existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OTP_PEPPER`, `RESEND_API_KEY`, and
`AUTH_MAIL_FROM` secrets are also required by `account-deletion`.
`purge-account-deletions` requires `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `PURGE_ACCOUNT_DELETIONS_TOKEN`,
`RESEND_API_KEY`, and `AUTH_MAIL_FROM`.

## Schedule the purge

Run `purge-account-deletions` at least hourly. The scheduler must send the
dedicated purge token as its Authorization bearer token. Store the token in
Supabase Vault or the scheduler's secret store; never place it in a migration
or source file. Do not use the service-role key as the scheduler bearer token.

The function permanently deletes only requests whose status is `pending` and
whose `scheduled_deletion_at` is at or before the database time. It claims each
request as `purging` before calling the Auth Admin API. Failed deletions return
to `pending` for the next retry.

After a successful Auth user deletion, the function sends a deletion-completed
email to the stored login email. Email delivery failures are logged and included
in the response as `notificationFailed`, but they do not roll back or block the
permanent deletion.

## Monitoring

- Alert on non-2xx responses or a `partial` response from the purge function.
- Review `notificationFailed` in the purge response. A notification failure does
  not mean the deletion failed.
- Review requests stuck in `preparing`, `restoring`, or `purging`.
- Confirm the scheduler after every credential rotation.
- Remember that access-token JWTs cannot be revoked before expiry; the migration
  therefore updates RLS policies to block pending users immediately.

## Rollout and rollback

Deploy the migration before the two functions and frontend. Rolling back the
frontend is safe, but do not remove the purge schedule while pending requests
exist. To restore a user manually before the deadline, use the same recovery
flow rather than editing Auth or deletion tables independently.
