import { supabase } from "../lib/supabaseClient";
import type { LocalePreference, ResolvedLocale } from "../i18n/language";

export type BeginSignUpResult =
  | { status: "accepted"; message?: string }
  | { status: "otp_sent"; message?: string }
  | { status: "error"; message?: string; code?: string | null };

export type BeginSignUpDraft = Omit<PendingSignUpDraft, "password">;

function buildBeginSignUpDraft(draft: PendingSignUpDraft): BeginSignUpDraft {
  return {
    email: draft.email.trim().toLowerCase(),
    displayName: draft.displayName,
    familyName: draft.familyName,
    givenName: draft.givenName,
    agreedTermsAt: draft.agreedTermsAt,
    termsVersion: draft.termsVersion,
    agreedPrivacyAt: draft.agreedPrivacyAt,
    privacyVersion: draft.privacyVersion,
    localePreference: draft.localePreference,
    resolvedLocale: draft.resolvedLocale,
  };
}
  
export async function beginSignUp(draft: PendingSignUpDraft): Promise<BeginSignUpResult> {
  const { data, error } = await supabase.functions.invoke("begin-signup", {
    body: buildBeginSignUpDraft(draft),
  });

  if (error) throw error;
  return data as BeginSignUpResult;
}
  
export type PendingSignUpDraft = {
  email: string;
  password: string;
  displayName: string;
  familyName: string;
  givenName: string;
  agreedTermsAt: string;
  termsVersion: string;
  agreedPrivacyAt: string;
  privacyVersion: string;
  localePreference: LocalePreference;
  resolvedLocale: ResolvedLocale;
};

type ProfileDraft = BeginSignUpDraft;

export type OAuthProvider = "google" | "apple";
export type PendingOAuthSignUpDraft = Omit<BeginSignUpDraft, "email">;

function buildUserMetadata(draft: ProfileDraft) {
  return {
    display_name: draft.displayName,
    family_name: draft.familyName || null,
    given_name: draft.givenName || null,
    agreed_terms_at: draft.agreedTermsAt,
    terms_version: draft.termsVersion,
    agreed_privacy_at: draft.agreedPrivacyAt,
    privacy_version: draft.privacyVersion,
    locale_preference: draft.localePreference,
    resolved_locale: draft.resolvedLocale,
  };
}

function buildProfilePayload(userId: string, draft: ProfileDraft) {
  return {
    id: userId,
    email: draft.email,
    display_name: draft.displayName,
    family_name: draft.familyName || null,
    given_name: draft.givenName || null,
    agreed_terms_at: draft.agreedTermsAt,
    terms_version: draft.termsVersion,
    agreed_privacy_at: draft.agreedPrivacyAt,
    privacy_version: draft.privacyVersion,
    locale_preference: draft.localePreference,
    resolved_locale: draft.resolvedLocale,
  };
}

export async function resendSignUpOtp(draft: PendingSignUpDraft): Promise<BeginSignUpResult> {
  return beginSignUp(draft);
}

export async function verifyEmailOtp(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) throw error;
  return data;
}

export async function completeProfileAfterOtp(draft: PendingSignUpDraft) {
  const user = await getUser();
  if (!user) throw new Error("User is not signed in");

  const userMetadata = {
    ...(user.user_metadata ?? {}),
    ...buildUserMetadata(draft),
  };

  const { data: updatedUserData, error: updateUserError } = await supabase.auth.updateUser({
    password: draft.password,
    data: userMetadata,
  });

  if (updateUserError) throw updateUserError;

  const { error: profileError } = await supabase.from("profiles").upsert(
    buildProfilePayload(user.id, draft),
    { onConflict: "id" }
  );

  if (profileError) throw profileError;

  return updatedUserData.user ?? user;
}

export async function completeProfileAfterOAuth(draft: BeginSignUpDraft) {
  const user = await getUser();
  if (!user) throw new Error("User is not signed in");

  const userMetadata = {
    ...(user.user_metadata ?? {}),
    ...buildUserMetadata(draft),
  };

  const { data: updatedUserData, error: updateUserError } = await supabase.auth.updateUser({
    data: userMetadata,
  });

  if (updateUserError) throw updateUserError;

  const { error: profileError } = await supabase.from("profiles").upsert(
    buildProfilePayload(user.id, draft),
    { onConflict: "id" }
  );

  if (profileError) throw profileError;

  return updatedUserData.user ?? user;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithOAuthProvider(
  provider: OAuthProvider,
  redirectTo: string
) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
    },
  });
  if (error) throw error;
  return data;
}

export async function changePassword(newPassword: string): Promise<void> {
  if (!newPassword) throw new Error("newPassword is required");

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session; // null or Session
}

export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user; // null or User
}

export type ProfileCompletion = {
  display_name: string | null;
  agreed_terms_at: string | null;
  terms_version: string | null;
  agreed_privacy_at: string | null;
  privacy_version: string | null;
};

export function isProfileComplete(profile: ProfileCompletion | null): boolean {
  return Boolean(
    profile?.display_name?.trim() &&
      profile.agreed_terms_at &&
      profile.terms_version &&
      profile.agreed_privacy_at &&
      profile.privacy_version
  );
}

export async function getProfileCompletion(
  userId: string
): Promise<ProfileCompletion | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "display_name,agreed_terms_at,terms_version,agreed_privacy_at,privacy_version"
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as ProfileCompletion | null;
}

function collectAuthProviderIds(user: unknown): string[] {
  const providerIds = new Set<string>();
  const record = user as {
    app_metadata?: {
      provider?: unknown;
      providers?: unknown;
    };
    identities?: Array<{ provider?: unknown }>;
  } | null;

  const primaryProvider = record?.app_metadata?.provider;
  if (typeof primaryProvider === "string" && primaryProvider) {
    providerIds.add(primaryProvider);
  }

  const providers = record?.app_metadata?.providers;
  if (Array.isArray(providers)) {
    providers.forEach((provider) => {
      if (typeof provider === "string" && provider) providerIds.add(provider);
    });
  }

  record?.identities?.forEach((identity) => {
    if (typeof identity.provider === "string" && identity.provider) {
      providerIds.add(identity.provider);
    }
  });

  return [...providerIds];
}

export function userRequiresPasswordForDeletion(user: unknown): boolean {
  const providers = collectAuthProviderIds(user);
  if (providers.length === 0) return true;
  return providers.includes("email");
}

export async function currentUserRequiresPasswordForDeletion(): Promise<boolean> {
  const user = await getUser();
  if (!user) return true;
  return userRequiresPasswordForDeletion(user);
}

export type ProfileLocale = {
  locale_preference: LocalePreference | null;
  resolved_locale: ResolvedLocale | null;
};

export type UpdateLocaleSettingsInput = {
  localePreference: LocalePreference;
  resolvedLocale: ResolvedLocale;
};

export async function getProfileLocale(userId: string): Promise<ProfileLocale | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("locale_preference,resolved_locale")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as ProfileLocale | null;
}

export async function updateLocaleSettings(
  input: UpdateLocaleSettingsInput
): Promise<ProfileLocale> {
  const user = await getUser();
  if (!user) throw new Error("User is not signed in");

  const nextProfileLocale = {
    locale_preference: input.localePreference,
    resolved_locale: input.resolvedLocale,
  };

  const nextUserMetadata = {
    ...(user.user_metadata ?? {}),
    ...nextProfileLocale,
  };

  const { error: updateUserError } = await supabase.auth.updateUser({
    data: nextUserMetadata,
  });

  if (updateUserError) throw updateUserError;

  const { data, error: profileError } = await supabase
    .from("profiles")
    .update(nextProfileLocale)
    .eq("id", user.id)
    .select("locale_preference,resolved_locale")
    .maybeSingle();

  if (profileError) throw profileError;
  if (!data) throw new Error("Profile not found");

  return data as ProfileLocale;
}

export type AccountEmail = {
  id: string;
  user_id: string;
  email: string;
  normalized_email: string;
  is_verified: boolean;
  use_for_2fa: boolean;
  use_for_recovery: boolean;
  use_for_notification: boolean;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SendVerifyAccountEmailOtpResult =
  | {
      status: "sent";
      message?: string;
      accountEmailId: string;
      maskedEmail: string;
      expiresInMinutes: number;
    }
  | {
      status: "already_verified";
      message?: string;
      accountEmailId: string;
      maskedEmail: string;
    };

  export type SendLoginEmailChangeOtpResult = {
    status: "sent";
    message?: string;
    accountEmailId: string;
    maskedEmail: string;
    expiresInMinutes: number;
  };

  export type PromoteAccountEmailToLoginResult = {
    status: "changed";
    message?: string;
    loginEmail: string;
    maskedLoginEmail: string;
    oldLoginEmailRetained: boolean;
  };

  export type VerifyAccountEmailOtpResult =
    | {
        status: "verified";
        message?: string;
        accountEmailId: string;
        maskedEmail: string;
      }
    | {
        status: "already_verified";
        message?: string;
        accountEmailId: string;
        maskedEmail: string;
      };
  
      export type RequestPasswordResetResult = {
        status: "ok";
        message?: string;
      };
      
      export type StartLogin2faResult =
        | {
            required: false;
            reason?: "no_2fa_email" | "trusted_browser";
          }
        | {
            required: true;
            message?: string;
            accountEmailId: string;
            maskedEmail: string;
            expiresInMinutes: number;
          };
      
      export type VerifyLogin2faResult = {
        status: "verified";
        message?: string;
        trustedDays?: number;
      };
      
      export async function getCurrentLoginEmail(): Promise<string> {
      const user = await getUser();
      return user?.email ?? "";
    }
    
    function normalizeAccountEmailForCompare(email: string) {
      return email.trim().toLowerCase();
    }
    
    export async function listAccountEmails(): Promise<AccountEmail[]> {
  const { data, error } = await supabase
    .from("account_emails")
    .select(
      [
        "id",
        "user_id",
        "email",
        "normalized_email",
        "is_verified",
        "use_for_2fa",
        "use_for_recovery",
        "use_for_notification",
        "verified_at",
        "created_at",
        "updated_at",
      ].join(",")
    )
    .order("created_at", { ascending: true });

    if (error) throw error;

    return (data ?? []) as unknown as AccountEmail[];
  }

  export async function sendVerifyAccountEmailOtp(
    email: string,
    resolvedLocale?: ResolvedLocale
  ): Promise<SendVerifyAccountEmailOtpResult> {
    const normalizedEmail = normalizeAccountEmailForCompare(email);
  
    if (!normalizedEmail) {
      throw new Error("email is required");
    }
  
    const user = await getUser();
    const normalizedLoginEmail = normalizeAccountEmailForCompare(user?.email ?? "");
  
    if (normalizedLoginEmail && normalizedEmail === normalizedLoginEmail) {
      throw new Error(
        "ログイン用メールアドレスはサブメールとして登録できません。別のメールアドレスを入力してください。"
      );
    }
  
    const { data, error } = await supabase.functions.invoke("account-security", {
      body: {
        action: "send_verify_email_otp",
        email: normalizedEmail,
        resolvedLocale,
      },
    });
  
    if (error) throw error;
  
    return data as SendVerifyAccountEmailOtpResult;
  }


  
  export async function deleteAccountEmail(accountEmailId: string): Promise<void> {
    const user = await getUser();
    if (!user) throw new Error("User is not signed in");
  
    if (!accountEmailId) {
      throw new Error("accountEmailId is required");
    }
  
    const { error } = await supabase
      .from("account_emails")
      .delete()
      .eq("id", accountEmailId)
      .eq("user_id", user.id);
  
    if (error) throw error;
  }
  
  export async function verifyAccountEmailOtp(
    accountEmailId: string,
    otp: string
  ): Promise<VerifyAccountEmailOtpResult> {
    const normalizedOtp = otp.trim();
  
    if (!accountEmailId) {
      throw new Error("accountEmailId is required");
    }
  
    if (!/^\d{6}$/.test(normalizedOtp)) {
      throw new Error("確認コードは6桁の数字で入力してください。");
    }
  
    const { data, error } = await supabase.functions.invoke("account-security", {
      body: {
        action: "verify_email_otp",
        accountEmailId,
        otp: normalizedOtp,
      },
    });
  
    if (error) throw error;
  
    return data as VerifyAccountEmailOtpResult;
  }

  export async function sendLoginEmailChangeOtp(args: {
    accountEmailId: string;
    resolvedLocale?: ResolvedLocale;
  }): Promise<SendLoginEmailChangeOtpResult> {
    if (!args.accountEmailId) {
      throw new Error("accountEmailId is required");
    }

    const { data, error } = await supabase.functions.invoke("account-security", {
      body: {
        action: "send_change_login_email_otp",
        accountEmailId: args.accountEmailId,
        resolvedLocale: args.resolvedLocale,
      },
    });

    if (error) throw error;

    return data as SendLoginEmailChangeOtpResult;
  }

  export async function promoteAccountEmailToLogin(args: {
    accountEmailId: string;
    otp: string;
    resolvedLocale?: ResolvedLocale;
  }): Promise<PromoteAccountEmailToLoginResult> {
    const normalizedOtp = args.otp.trim();

    if (!args.accountEmailId) {
      throw new Error("accountEmailId is required");
    }

    if (!/^\d{6}$/.test(normalizedOtp)) {
      throw new Error(
        args.resolvedLocale === "ja"
          ? "確認コードは6桁の数字で入力してください。"
          : "Verification code must be 6 digits."
      );
    }

    const { data, error } = await supabase.functions.invoke("account-security", {
      body: {
        action: "promote_account_email_to_login",
        accountEmailId: args.accountEmailId,
        otp: normalizedOtp,
        resolvedLocale: args.resolvedLocale,
      },
    });

    if (error) throw error;

    return data as PromoteAccountEmailToLoginResult;
  }
  
  export async function startLogin2fa(args: {
    browserSecret: string;
    resolvedLocale?: ResolvedLocale;
  }): Promise<StartLogin2faResult> {
    const { data, error } = await supabase.functions.invoke("account-security", {
      body: {
        action: "start_login_2fa",
        browserSecret: args.browserSecret,
        resolvedLocale: args.resolvedLocale,
      },
    });
  
    if (error) throw error;
  
    return data as StartLogin2faResult;
  }
  
  export async function verifyLogin2fa(args: {
    accountEmailId: string;
    otp: string;
    browserSecret: string;
  }): Promise<VerifyLogin2faResult> {
    const { data, error } = await supabase.functions.invoke("account-security", {
      body: {
        action: "verify_login_2fa",
        accountEmailId: args.accountEmailId,
        otp: args.otp.trim(),
        browserSecret: args.browserSecret,
      },
    });
  
    if (error) throw error;
  
    return data as VerifyLogin2faResult;
  }

  export async function requestPasswordResetEmail(args: {
    email: string;
    redirectTo: string;
    resolvedLocale?: ResolvedLocale;
  }): Promise<RequestPasswordResetResult> {
    const normalizedEmail = args.email.trim().toLowerCase();
  
    if (!normalizedEmail) {
      throw new Error("email is required");
    }
  
    const { data, error } = await supabase.functions.invoke(
      "request-password-reset",
      {
        body: {
          email: normalizedEmail,
          redirectTo: args.redirectTo,
          resolvedLocale: args.resolvedLocale,
        },
      }
    );
  
    if (error) throw error;
  
    return data as RequestPasswordResetResult;
  }

export class AccountDeletionError extends Error {
  readonly code: string | null;
  readonly status: number | null;

  constructor(
    message: string,
    code: string | null = null,
    status: number | null = null
  ) {
    super(message);
    this.name = "AccountDeletionError";
    this.code = code;
    this.status = status;
  }
}

async function invokeAccountDeletion<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("account-deletion", {
    body,
  });

  if (!error) return data as T;

  const context = (error as { context?: unknown }).context;
  let code: string | null = null;
  let message = error.message || "Account deletion request failed.";
  let status: number | null = null;

  if (context instanceof Response) {
    status = context.status;
    const payload = await context
      .clone()
      .json()
      .catch(() => null) as { error?: unknown; message?: unknown } | null;
    if (payload?.error) code = String(payload.error);
    if (payload?.message) message = String(payload.message);
  }

  throw new AccountDeletionError(message, code, status);
}

export type StartAccountDeletionResult = {
  status: "otp_sent";
  maskedEmail: string;
  expiresInMinutes: number;
};

export type ConfirmAccountDeletionResult = {
  status: "scheduled";
  scheduledDeletionAt: string;
  recoveryCodeDeliveredTo: number;
  recoveryDestinationCount: number;
};

export async function startAccountDeletion(args: {
  password?: string;
  resolvedLocale?: ResolvedLocale;
}): Promise<StartAccountDeletionResult> {
  return invokeAccountDeletion<StartAccountDeletionResult>({
    action: "start_deletion",
    password: args.password ?? "",
    resolvedLocale: args.resolvedLocale,
  });
}

export async function confirmAccountDeletion(args: {
  otp: string;
  resolvedLocale?: ResolvedLocale;
}): Promise<ConfirmAccountDeletionResult> {
  return invokeAccountDeletion<ConfirmAccountDeletionResult>({
    action: "confirm_deletion",
    otp: args.otp.trim(),
    resolvedLocale: args.resolvedLocale,
  });
}

export async function restoreDeletedAccount(args: {
  email: string;
  recoveryCode: string;
}): Promise<{ status: "restored" }> {
  return invokeAccountDeletion<{ status: "restored" }>({
    action: "restore_account",
    email: args.email.trim().toLowerCase(),
    recoveryCode: args.recoveryCode.trim(),
  });
}

export async function resendAccountRecoveryCode(args: {
  email: string;
  resolvedLocale?: ResolvedLocale;
}): Promise<{ status: "accepted" }> {
  return invokeAccountDeletion<{ status: "accepted" }>({
    action: "resend_recovery_code",
    email: args.email.trim().toLowerCase(),
    resolvedLocale: args.resolvedLocale,
  });
}
