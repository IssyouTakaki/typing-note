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

- The app asks for the current password, even though the Supabase Dashboard
  setting is disabled.
- The current password is checked by signing in again with the current Login
  mail and supplied password.
- The new password uses the same client-side policy as sign-up and reset:
  minimum 8 characters, at least one lowercase letter, one uppercase letter,
  and one digit.
- After the password is updated, the user is signed out and returned to the
  Sign in screen.
