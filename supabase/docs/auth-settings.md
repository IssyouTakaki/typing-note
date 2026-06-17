# Supabase Auth Settings

Do not include secrets such as service_role keys, JWT secrets, SMTP passwords,
Resend API keys, or OTP pepper values in this file.

## Dashboard Values Recorded

Recorded from Supabase Dashboard screenshots shared on 2026-06-17.

| Setting | Current value | Target / note |
| --- | --- | --- |
| Project URL | not recorded | Public project URL only, no secret keys |
| Site URL | `https://issyouTakaki.github.io/typing-note/` | Default auth redirect URL |
| Additional redirect URLs | `http://localhost:5173/typing-note/**`, `https://issyouTakaki.github.io/typing-note/**` | Local dev and GitHub Pages |
| Email provider enabled | enabled | Required for password auth |
| Confirm email | enabled | Users confirm email before first sign-in |
| Secure email change | enabled | Supabase client email changes require old and new email confirmation |
| Confirm email change | enabled by template/config context | Change email template is configured |
| Secure password change | disabled | App will require current password before changing password |
| Require current password when updating | disabled | App will enforce this at UI/repo layer |
| Prevent use of leaked passwords | disabled | Free plan screen notes this is Pro plan and above |
| Email OTP enabled | enabled by template/config context | Magic link or OTP template is configured |
| Password min length | 8 | TypingNote client policy is 8 |
| Password requires uppercase | TODO | TypingNote client requires uppercase |
| Password requires lowercase | TODO | TypingNote client requires lowercase |
| Password requires digit | TODO | TypingNote client requires digit |

## Email Templates Recorded

| Template | Subject | Body token / link observed | Note |
| --- | --- | --- | --- |
| Confirm sign up | `Confirm Your Signup` | `{{ .Token }}` | Japanese OTP body customized for TypingNote |
| Invite user | `You have been invited` | `{{ .ConfirmationURL }}` | Default invite link |
| Magic link or OTP | `Your Magic Link` | `{{ .Token }}` | Japanese OTP body customized for TypingNote |
| Change email address | `Confirm Email Change` | `{{ .ConfirmationURL }}` | Uses `{{ .Email }}` and `{{ .NewEmail }}` |
| Reset password | `Reset Your Password` | `{{ .ConfirmationURL }}` | Password reset link |
| Reauthentication | `Confirm Reauthentication` | `{{ .Token }}` | Sensitive operation OTP |

## Security Notification Emails

The following notification emails are configured off in the screenshots:

- Password changed
- Email address changed
- Phone number changed
- Sign-in method linked
- Sign-in method removed
- MFA method added
- MFA method removed

## Edge Function

Function name:

```txt
account-security
```

Source file:

```txt
supabase/functions/account-security/index.ts
```

Required environment variables. Record only whether they exist, never the
values.

| Variable | Present in Supabase? | Purpose |
| --- | --- | --- |
| SUPABASE_URL | default / not shown in custom secrets | Supabase project URL |
| SUPABASE_ANON_KEY | default / not shown in custom secrets | Validates the caller's user token |
| SUPABASE_SERVICE_ROLE_KEY | default / not shown in custom secrets | Server-side account security operations |
| OTP_PEPPER | present | Hashes OTP and trusted-browser secrets |
| RESEND_API_KEY | present | Sends verification emails |
| AUTH_MAIL_FROM | present | From address for account-security emails |
| PASSWORD_RESET_PAGE_URL | present | Password reset landing URL |
| SEND_EMAIL_HOOK_SECRET | present | Send-email hook validation secret |

Functions visible in the dashboard:

- `account-security`
- `begin-signup`
- `request-password-reset`
- `send-auth-email`

## Database Objects

Migration draft:

```txt
supabase/migrations/20260616_account_emails.sql
```

Tables expected by the current TypingNote code:

| Table | Purpose | Direct client access |
| --- | --- | --- |
| public.account_emails | User-owned security email addresses | Select/delete own rows |
| public.account_email_otp_challenges | OTP challenge hashes and rate-limit data | No direct client access |
| public.account_trusted_browsers | Trusted browser hashes for login 2FA | No direct client access |

## Login Mail Change Design Notes

Goal: allow a user to switch Login mail to a verified Security mail even when
the old Login mail is unavailable.

Recommended rule:

- The new Login mail must already be a verified row in `account_emails`.
- The change should be performed server-side by `account-security`.
- The user should confirm the target Security mail with a fresh OTP immediately
  before promotion.
- After promotion, decide whether the old Login mail becomes a Security mail or
  is removed.
- Do not require a confirmation email sent to the old Login mail.

## Logged-In Password Change Design Notes

Recommended rule:

- Require current password.
- Validate the new password with the same policy used by sign-up/reset.
- Reauthenticate with the current password before calling password update.
- Sign the user out after a successful password change, or clearly tell them
  whether the current session remains valid.
