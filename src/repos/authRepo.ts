import { supabase } from "../lib/supabaseClient";

export type BeginSignUpResult =
  | { status: "accepted"; message?: string }
  | { status: "otp_sent"; message?: string }
  | { status: "error"; message?: string; code?: string | null };

export async function beginSignUp(draft: PendingSignUpDraft): Promise<BeginSignUpResult> {
  const normalizedDraft = {
    ...draft,
    email: draft.email.trim().toLowerCase(),
  };

  const { data, error } = await supabase.functions.invoke("begin-signup", {
    body: normalizedDraft,
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
};

function buildUserMetadata(draft: PendingSignUpDraft) {
  return {
    display_name: draft.displayName,
    family_name: draft.familyName || null,
    given_name: draft.givenName || null,
    agreed_terms_at: draft.agreedTermsAt,
    terms_version: draft.termsVersion,
    agreed_privacy_at: draft.agreedPrivacyAt,
    privacy_version: draft.privacyVersion,
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
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("認証済みユーザーを取得できませんでした。");

  const { error: updateUserError } = await supabase.auth.updateUser({
    password: draft.password,
    data: buildUserMetadata(draft),
  });
  if (updateUserError) throw updateUserError;

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: draft.email,
      display_name: draft.displayName,
      family_name: draft.familyName || null,
      given_name: draft.givenName || null,
      agreed_terms_at: draft.agreedTermsAt,
      terms_version: draft.termsVersion,
      agreed_privacy_at: draft.agreedPrivacyAt,
      privacy_version: draft.privacyVersion,
    },
    { onConflict: "id" }
  );
  if (profileError) throw profileError;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
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