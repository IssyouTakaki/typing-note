# Account Security Flows

This file records the agreed implementation behavior for TypingNote account
security changes. Do not include secrets.

## Login Mail Change

Goal: allow a signed-in user to change Login mail even when the old Login mail
can no longer receive email.

Agreed behavior:

- A Login mail can be changed only to a verified Security email.
- Before promotion, TypingNote sends a fresh OTP to the target Security email.
- The OTP purpose is `change_email`, matching the current remote DB constraint.
- The actual auth email change is performed in the `account-security` Edge
  Function with the Supabase Admin API.
- The Edge Function sets the new auth email as confirmed.
- `profiles.email` is synchronized to the new Login mail.
- The promoted Security email is removed from `account_emails`.
- The old Login mail is kept in `account_emails` as a verified Security email,
  with `use_for_2fa = false`, `use_for_recovery = false`, and
  `use_for_notification = false`.
- The user remains signed in after the Login mail change.

## Logged-In Password Change

Goal: let a signed-in user change password from Account settings.

Agreed behavior:

- The user does not need to enter the current password.
- The existing authenticated session authorizes the password update.
- The new password uses the same client-side policy as sign-up and reset:
  minimum 8 characters, at least one lowercase letter, one uppercase letter,
  and one digit.
- After the password is updated, the current session remains signed in and the
  user stays on the Account settings screen.

## Recoverable Account Deletion

Goal: require strong confirmation, block the account immediately, and allow
recovery for 30 days before permanent deletion.

Agreed behavior:

- The signed-in user must enter the current password.
- TypingNote sends a 6-digit, 10-minute OTP to the current Login mail.
- Only after the OTP and final confirmation are accepted does the 30-day grace
  period begin.
- The Auth user and all owned data remain present during the grace period.
- The user is banned, refresh tokens are revoked, and RLS plus Edge Functions
  reject normal access while deletion is pending.
- A high-entropy recovery code is hashed before storage. The plaintext code is
  sent to the Login mail and every verified Security mail with
  `use_for_recovery = true`.
- Recovery requires the Login mail and a valid recovery code before
  `scheduled_deletion_at`. Recovery lifts the ban, removes the deletion request,
  and requires a normal sign-in afterward.
- Recovery-code resend is generic to prevent account enumeration, limited to
  once per hour and five codes for one deletion request.
- A scheduled purge function permanently deletes due Auth users. Owned rows
  with `on delete cascade` are deleted, while `app_events.user_id` becomes null.
- PostHog data, Resend logs, delivered feedback email, and provider backups are
  outside this automated deletion flow.
