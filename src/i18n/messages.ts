import type { ResolvedLocale } from "./language";

const ja = {
  createAccount: "アカウント作成",

  authHelp:
    "既存アカウントで Sign in してください。\nアカウント未作成ならアカウント作成から進めます。",
  forgotPassword: "パスワードを再設定",
  backToTypingNote: "TypingNote に戻る",
  terms: "利用規約",
  privacy: "プライバシーポリシー",

  signupTitle: "TypingNote アカウント作成",
  signupHelp: "アカウント情報を入力すると、次の画面でメール確認に進みます。",
  requiredPlaceholder: "必須",
  optionalPlaceholder: "任意",
  passwordPolicyNote:
  "Password は 8 文字以上で、英大文字・英小文字・数字を各 1 文字以上含めてください。",
  agreeToTermsSuffix: "に同意する",
  agreeToPrivacySuffix: "に同意する",
  proceedToEmailVerification: "メール確認へ進む",
  backToSignIn: "Sign in に戻る",

  signupOtpHelp:
    "メールに記載された案内を確認してください。認証コードが記載されている場合は、下に入力してください。",
  verifyAndCreateAccount: "認証してアカウント作成",
  resendCode: "コードを再送",
  backToSignupInput: "入力画面に戻る",

  forgotPasswordTitle: "パスワード再設定",
  forgotPasswordHelp:
    "メールアドレスを入力してください。\n登録済みのログイン用メールアドレスまたはサブメールに手続きメールを送信します。",
  sendEmail: "メールを送信",

  resetPasswordTitle: "新しいパスワードを設定",
  resetPasswordHelp:
  "新しいパスワードを入力してください。\n8文字以上で、英大文字・英小文字・数字を各1文字以上含めてください。",
  newPassword: "新しいパスワード",
  newPasswordConfirm: "新しいパスワード（確認）",
  updatePassword: "パスワードを更新",
  goToSignIn: "Sign in へ進む",

  msgAuthRequiredEmailPassword: "Email と Password を入力してください。",
  msgDisplayNameRequired: "Display name を入力してください。",
  msgEmailRequired: "Email を入力してください。",
  msgPasswordRequired: "Password を入力してください。",
  msgPasswordConfirmMismatch: "Password と Confirm password が一致していません。",
  msgPasswordPolicyNotMetPrefix: "Password の条件を満たしていません: ",
  msgTermsPrivacyRequired: "利用規約とプライバシーポリシーへの同意が必要です。",
  msgSendingEmail: "メールを送信しています...",
  msgEmailSendFailed:
    "メール送信を完了できませんでした。しばらくしてから再度お試しください。",
  msgSignupEmailCheck:
    "入力されたメールアドレス宛にメールを送信しました。\nメールに記載された案内を確認してください。",
  msgSignupEmailCheckHelp:
    "入力されたメールアドレス宛に送信したメールを確認してください。認証コードが記載されている場合は、下に入力してください。",
  msgEmailProcedureCheck:
    "入力されたメールアドレス宛に手続きに関するメールを送信しました。\nメールに記載された案内を確認してください。",
  msgSignupDraftMissing:
    "アカウント作成情報が見つかりません。入力画面からやり直してください。",
  msgSignupInputFirst:
    "先にアカウント作成画面からメールアドレスを入力してください。",
  msgOtpCodeRequired: "8 桁の認証コードを入力してください。",
  msgVerifying: "認証しています...",
  msgResendingEmail: "メールを再送しています...",
  msgSessionNotEstablished:
    "サインイン処理は完了しましたが、session が確立できませんでした。\n（localStorage の制限 / Supabase URL・KEY の不一致 / 通信制限 等の可能性）\nコンソールの [auth] ログを確認してください。",
  msgResetEmailRequired: "メールアドレスを入力してください。",
  msgNewPasswordRequired: "新しいパスワードを入力してください。",
  msgNewPasswordConfirmMismatch: "確認用パスワードが一致しません。",
  msgNewPasswordPolicyNotMetPrefix: "パスワードの条件を満たしていません: ",
  msgPasswordUpdated:
    "パスワードを更新しました。\nセキュリティのため、再度ログインしてください。",
  msgPasswordUpdatedSignIn:
    "パスワードが更新されました。新しいパスワードでログインしてください。",

  msgAuthNetworkFailed:
    "サーバーとの通信に失敗しました。時間をおいて再度お試しください。",
  msgSignupProcedureFailed:
    "サインアップ確認処理でエラーが発生しました。設定またはサーバー状態を確認してください。",
  msgAuthFailed: "認証に失敗しました。",
  msgEmailProcedureConfigFailed:
    "メール送信を完了できませんでした。設定またはサーバー状態を確認してください。",

    msgSigningIn: "サインインしています...",
    msgAuthInvalidLoginCredentials:
      "メールアドレスまたはパスワードが正しくありません。",
    msgAuthEmailRateLimitExceeded:
      "メール送信の上限に達しました。しばらく待ってから再度お試しください。",
    msgAuthTooManyRequests:
      "短時間に何度も操作が行われました。しばらく待ってから再度お試しください。",
    msgAuthEmailNotConfirmed:
      "メール確認が完了していません。メールに記載された認証コードまたは確認リンクを確認してください。",
    msgAuthOtpExpired:
      "認証コードまたは確認リンクの有効期限が切れているか、正しくありません。再送してから再度お試しください。",
    msgAuthSessionMissing:
      "認証セッションが見つかりません。再度メールの手続きからやり直してください。",
    msgAuthUserAlreadyExists:
      "このメールアドレスでは、すでにアカウントが作成されています。",
    msgAuthPasswordSameAsOld:
      "現在のパスワードとは異なる新しいパスワードを設定してください。",
    msgAuthWeakPassword:
      "パスワードの条件を満たしていません。別のパスワードを設定してください。",
    msgAuthInvalidEmail: "メールアドレスの形式が正しくありません。",

    msgSaveRequiresAccount: "保存にはアカウント作成または Sign in が必要です。",
    msgExplorerRequiresSignIn: "Explorer を使うには Sign in が必要です。",
    msgDustRequiresSignIn: "Dust を使うには Sign in が必要です。",
    confirmTitle: "確認",
    confirmHintProceedCancel: "Y で実行 / N でキャンセル",
    confirmHintDeleteCancel: "Y で削除 / N でキャンセル",
  
    accountSettings: "アカウント設定",
    accountSettingsTitle: "アカウント設定",
    accountSettingsHelp: "表示言語、ログイン用メールアドレス、サブメール、パスワードを管理できます。",
    accountLanguageSectionTitle: "表示言語",
    languageLabel: "表示言語",
    languageAuto: "ブラウザ設定に合わせる",
    languageJa: "日本語",
    languageEn: "English",
    accountLoginEmailTitle: "ログイン用メールアドレス",
    accountLoginEmailNote:
      "ログイン用メールアドレスを変更するには、確認済みのサブメールを選択し、送信された確認コードを入力してください。",
    accountOtpSentPrefix: "確認コードの送信先: ",
    accountVerificationCodeLabel: "確認コード",
    accountChangeLoginEmail: "ログイン用メールアドレスを変更",
    accountSecurityEmailsTitle: "サブメール",
    accountSecurityEmailsNote:
      "サブメールはログイン確認、パスワード再設定、ログイン用メールアドレスの変更に使用できます。",
    accountEmailLoading: "読み込み中...",
    accountEmailEmpty: "登録済みのサブメールはありません。",
    accountAddSecurityEmail: "サブメールを追加",
    accountSendVerificationCode: "確認コードを送信",
    accountVerifyEmail: "メールアドレスを確認",
    accountPasswordTitle: "パスワード",
    accountPasswordNote:
      "新しいパスワードを設定する前に、現在のパスワードを入力してください。変更後はログアウトされます。",
    accountCurrentPassword: "現在のパスワード",
    accountChangePassword: "パスワードを変更",
    accountBadgeVerified: "確認済み",
    accountBadgePending: "未確認",
    accountBadgeRecoveryEnabled: "復旧用: 有効",
    accountBadgeRecoveryDisabled: "復旧用: 無効",
    accountBadge2faEnabled: "2FA: 有効",
    accountBadge2faDisabled: "2FA: 無効",
    accountUseAsLogin: "ログイン用に変更",
    accountUseAsLoginAria: "{email} をログイン用メールアドレスに変更",
    accountDelete: "削除",
    accountDeleteAria: "{email} を削除",
    accountThisEmail: "このメールアドレス",
    accountTargetSecurityEmailMissing: "対象のサブメールを特定できませんでした。",
    accountConfirmSendLoginEmailCode:
      "{email} に確認コードを送信し、ログイン用メールアドレスへの変更を開始しますか？",
    accountVerificationCodeSent: "確認コードを送信しました。",
    accountDeleteSecurityEmailConfirm: "{email} をサブメールから削除しますか？",
    accountDeletingSecurityEmail: "サブメールを削除しています...",
    accountDeletedSecurityEmail: "サブメールを削除しました。",
    accountDeleteSecurityEmailFailed: "サブメールを削除できませんでした。",
    accountUnknown: "不明",
    accountReadingSecurityEmailsFailed: "サブメール情報を読み込めませんでした。",
    accountSecurityEmailRequired: "追加するメールアドレスを入力してください。",
    accountCheckingEmail: "メールアドレスを確認しています...",
    accountLoginEmailCannotBeSecurityEmail:
      "ログイン用メールアドレスはサブメールとして登録できません。別のメールアドレスを入力してください。",
    accountSendingVerificationCode: "確認コードを送信しています...",
    accountEmailAlreadyVerified: "このメールアドレスはすでに確認済みです。",
    accountSendCodeFirst: "先に確認コードを送信してください。",
    accountCodeMustBeSixDigits: "確認コードは6桁の数字で入力してください。",
    accountVerifyingCode: "確認コードを検証しています...",
    accountEmailVerified: "メールアドレスを確認しました。",
    accountConfirmChangeLoginEmail:
      "この確認済みサブメールをログイン用メールアドレスに変更しますか？次回ログインから新しいメールアドレスを使用します。",
    accountChangingLoginEmail: "ログイン用メールアドレスを変更しています...",
    accountLoginEmailChangedOldRetained:
      "ログイン用メールアドレスを変更しました。以前のログイン用メールアドレスは、2FA と復旧用を無効にしたサブメールとして保持しました。",
    accountCurrentPasswordRequired: "現在のパスワードを入力してください。",
    accountConfirmChangePassword:
      "パスワードを変更しますか？変更後はログアウトされます。",
    accountChangingPassword: "パスワードを変更しています...",
    accountPasswordChangedSigningOut: "パスワードを変更しました。ログアウトしています...",
    login2faSecurityEmailFallback: "サブメール",
    login2faTitle: "二段階認証",
    login2faHelp:
      "サブメールに送信された確認コードを入力してください。\n送信先: {email}",
    login2faVerify: "確認する",
    login2faLogout: "ログアウト",
    msgLogin2faMissing: "二段階認証の情報が見つかりません。再度ログインしてください。",
    msgLoggedOut: "ログアウトしました。",
    adminAnalytics: "管理",
    adminAnalyticsHelp: "TypingNote 分析サマリー",
    adminAnalyticsButton: "管理",
    adminTotals: "合計",
    adminEvents: "イベント",
    adminRefresh: "更新",
    adminBackToAccountSettings: "アカウント設定に戻る",
    adminLoading: "分析情報を読み込んでいます...",
    adminLoadFailed: "分析情報を読み込めませんでした。",
    adminNotAvailable: "N/A",
    adminToday: "今日",
    adminLast7Days: "過去7日",
    adminLast30Days: "過去30日",
    adminSince: "{date} 以降",
    adminGenerated: "{date} 生成",
    adminRecentRowsCapped: "最近のイベント行は {count} 件で上限に達しました。",
    adminMetricRegisteredUsers: "登録ユーザー",
    adminMetricActiveMemos: "有効なメモ",
    adminMetricDustMemos: "Dust のメモ",
    adminMetricFeedbackLast30Days: "フィードバック（過去30日）",
    adminMetricEvents: "イベント",
    adminMetricAnonymousEvents: "匿名イベント",
    adminMetricSignedInEvents: "ログイン済みイベント",
    adminMetricAnonymousVisitors: "匿名訪問者",
    adminMetricSignedInUsers: "ログイン済みユーザー",
    adminEventMemoSaved: "メモ保存",
    adminEventMemoCreated: "メモ作成",
    adminEventMemoUpdated: "メモ更新",
    adminEventExplorerOpened: "Explorer 表示",
    adminEventDustOpened: "Dust 表示",
    adminEventSearchUsed: "検索使用",
    adminEventFeedbackSent: "フィードバック送信",
    adminEventSignInSucceeded: "サインイン成功",
    saveSettings: "保存",
    msgSettingsSaving: "設定を保存しています...",
    msgSettingsSaved: "設定を保存しました。",
    msgSettingsSaveFailed: "設定を保存できませんでした。しばらくしてから再度お試しください。",
  } as const;

const en: Record<keyof typeof ja, string> = {
  createAccount: "Create account",

  authHelp:
    "Sign in with your existing account.\nIf you do not have an account yet, create one first.",
  forgotPassword: "Reset password",
  backToTypingNote: "Back to TypingNote",
  terms: "Terms of Service",
  privacy: "Privacy Policy",

  signupTitle: "Create your TypingNote account",
  signupHelp: "Enter your account information, then continue to email verification.",
  requiredPlaceholder: "Required",
  optionalPlaceholder: "Optional",
  passwordPolicyNote:
  "Password must be at least 8 characters and include at least one uppercase letter, one lowercase letter, and one digit.",
  agreeToTermsSuffix: "I agree",
  agreeToPrivacySuffix: "I agree",
  proceedToEmailVerification: "Continue to email verification",
  backToSignIn: "Back to Sign in",
 
  signupOtpHelp:
    "Check the email we sent you. If it contains a verification code, enter it below.",
  verifyAndCreateAccount: "Verify and create account",
  resendCode: "Resend code",
  backToSignupInput: "Back to account form",

  forgotPasswordTitle: "Reset password",
  forgotPasswordHelp:
    "Enter your email address.\nWe will send instructions to your registered login email or Security email.",
  sendEmail: "Send email",

  resetPasswordTitle: "Set a new password",
  resetPasswordHelp:
  "Enter a new password.\nIt must be at least 8 characters and include at least one uppercase letter, one lowercase letter, and one digit.",
  newPassword: "New password",
  newPasswordConfirm: "Confirm new password",
  updatePassword: "Update password",
  goToSignIn: "Go to Sign in",

  msgAuthRequiredEmailPassword: "Enter Email and Password.",
  msgDisplayNameRequired: "Enter Display name.",
  msgEmailRequired: "Enter Email.",
  msgPasswordRequired: "Enter Password.",
  msgPasswordConfirmMismatch: "Password and Confirm password do not match.",
  msgPasswordPolicyNotMetPrefix: "Password does not meet the requirements: ",
  msgTermsPrivacyRequired: "You need to agree to the Terms of Service and Privacy Policy.",
  msgSendingEmail: "Sending email...",
  msgEmailSendFailed: "We could not send the email. Please try again later.",
  msgSignupEmailCheck:
    "We sent an email to the address you entered.\nPlease check the instructions in the email.",
  msgSignupEmailCheckHelp:
    "Check the email we sent to the address you entered. If it contains a verification code, enter it below.",
  msgEmailProcedureCheck:
    "We sent an email with instructions to the address you entered.\nPlease check the email.",
  msgSignupDraftMissing:
    "Account creation information was not found. Please start again from the account form.",
  msgSignupInputFirst:
    "Please enter your email address from the account creation screen first.",
  msgOtpCodeRequired: "Enter the 8-digit verification code.",
  msgVerifying: "Verifying...",
  msgResendingEmail: "Resending email...",
  msgSessionNotEstablished:
    "Sign in completed, but the session could not be established.\nThis may be caused by localStorage restrictions, Supabase URL/key mismatch, or network restrictions.\nPlease check the [auth] logs in the console.",
  msgResetEmailRequired: "Enter your email address.",
  msgNewPasswordRequired: "Enter your new password.",
  msgNewPasswordConfirmMismatch: "The confirmation password does not match.",
  msgNewPasswordPolicyNotMetPrefix: "Password does not meet the requirements: ",
  msgPasswordUpdated:
    "Your password has been updated.\nFor security, please sign in again.",
  msgPasswordUpdatedSignIn:
    "Your password has been updated. Please sign in with your new password.",

  msgAuthNetworkFailed:
    "Could not connect to the server. Please wait a moment and try again.",
  msgSignupProcedureFailed:
    "An error occurred during the sign-up confirmation process. Please check the settings or server status.",
  msgAuthFailed: "Authentication failed.",
  msgEmailProcedureConfigFailed:
    "Could not complete email sending. Please check the settings or server status.",

    msgSigningIn: "Signing in...",
    msgAuthInvalidLoginCredentials: "Invalid login credentials.",
    msgAuthEmailRateLimitExceeded:
      "Email rate limit exceeded. Please wait a while and try again.",
    msgAuthTooManyRequests:
      "Too many requests. Please wait a while and try again.",
    msgAuthEmailNotConfirmed:
      "Email confirmation is not complete. Please check the verification code or confirmation link in your email.",
    msgAuthOtpExpired:
      "The verification code or confirmation link has expired or is invalid. Please resend it and try again.",
    msgAuthSessionMissing:
      "Authentication session was not found. Please start again from the email procedure.",
    msgAuthUserAlreadyExists:
      "An account already exists for this email address.",
    msgAuthPasswordSameAsOld:
      "Please set a new password that is different from your current password.",
    msgAuthWeakPassword:
      "Password does not meet the requirements. Please choose another password.",
    msgAuthInvalidEmail: "Invalid email address.",

    msgSaveRequiresAccount: "You need to create an account or Sign in to save.",
    msgExplorerRequiresSignIn: "You need to Sign in to use Explorer.",
    msgDustRequiresSignIn: "You need to Sign in to use Dust.",
    confirmTitle: "Confirm",
    confirmHintProceedCancel: "Press Y to proceed / N to cancel",
    confirmHintDeleteCancel: "Press Y to delete / N to cancel",
  
    accountSettings: "Account settings",
    accountSettingsTitle: "Account settings",
    accountSettingsHelp: "Choose your display language and manage login email, security emails, and password.",
    accountLanguageSectionTitle: "Language",
    languageLabel: "Language",
    languageAuto: "Match browser language",
    languageJa: "日本語",
    languageEn: "English",
    accountLoginEmailTitle: "Login email",
    accountLoginEmailNote:
      "To change the login email, choose a verified security email below and confirm the code sent to it.",
    accountOtpSentPrefix: "Verification code sent to ",
    accountVerificationCodeLabel: "Verification code",
    accountChangeLoginEmail: "Change login email",
    accountSecurityEmailsTitle: "Security emails",
    accountSecurityEmailsNote:
      "Security emails can be used for login verification, recovery, and login email changes.",
    accountEmailLoading: "Loading...",
    accountEmailEmpty: "No security emails are registered.",
    accountAddSecurityEmail: "Add security email",
    accountSendVerificationCode: "Send verification code",
    accountVerifyEmail: "Verify email",
    accountPasswordTitle: "Password",
    accountPasswordNote:
      "Enter your current password before setting a new password. After the change, you will be signed out.",
    accountCurrentPassword: "Current password",
    accountChangePassword: "Change password",
    accountBadgeVerified: "Verified",
    accountBadgePending: "Pending",
    accountBadgeRecoveryEnabled: "Recovery: on",
    accountBadgeRecoveryDisabled: "Recovery: off",
    accountBadge2faEnabled: "2FA: on",
    accountBadge2faDisabled: "2FA: off",
    accountUseAsLogin: "Use as login",
    accountUseAsLoginAria: "Use {email} as login email",
    accountDelete: "Delete",
    accountDeleteAria: "Delete {email}",
    accountThisEmail: "this email",
    accountTargetSecurityEmailMissing: "Could not identify the target security email.",
    accountConfirmSendLoginEmailCode:
      "Send a verification code to {email} and prepare to use it as the login email?",
    accountVerificationCodeSent: "Verification code sent.",
    accountDeleteSecurityEmailConfirm: "Delete {email} from security emails?",
    accountDeletingSecurityEmail: "Deleting security email...",
    accountDeletedSecurityEmail: "Security email deleted.",
    accountDeleteSecurityEmailFailed: "Could not delete the security email.",
    accountUnknown: "Unknown",
    accountReadingSecurityEmailsFailed: "Could not load security email information.",
    accountSecurityEmailRequired: "Enter the email address to add.",
    accountCheckingEmail: "Checking email address...",
    accountLoginEmailCannotBeSecurityEmail:
      "The login email cannot be registered as a security email. Enter a different email address.",
    accountSendingVerificationCode: "Sending verification code...",
    accountEmailAlreadyVerified: "This email address is already verified.",
    accountSendCodeFirst: "Send a verification code first.",
    accountCodeMustBeSixDigits: "Verification code must be 6 digits.",
    accountVerifyingCode: "Verifying code...",
    accountEmailVerified: "Email address verified.",
    accountConfirmChangeLoginEmail:
      "Change your login email to this verified security email? You will use the new email next time you sign in.",
    accountChangingLoginEmail: "Changing login email...",
    accountLoginEmailChangedOldRetained:
      "Login email changed. The old login email was kept as a security email with 2FA and recovery off.",
    accountCurrentPasswordRequired: "Enter your current password.",
    accountConfirmChangePassword:
      "Change your password now? You will be signed out after the password is changed.",
    accountChangingPassword: "Changing password...",
    accountPasswordChangedSigningOut: "Password changed. Signing out...",
    login2faSecurityEmailFallback: "Security email",
    login2faTitle: "Two-step verification",
    login2faHelp:
      "Enter the verification code sent to your security email.\nDestination: {email}",
    login2faVerify: "Verify",
    login2faLogout: "Sign out",
    msgLogin2faMissing: "Two-step verification information was not found. Please sign in again.",
    msgLoggedOut: "Signed out.",
    adminAnalytics: "Admin",
    adminAnalyticsHelp: "TypingNote analytics summary",
    adminAnalyticsButton: "Admin",
    adminTotals: "Totals",
    adminEvents: "Events",
    adminRefresh: "Refresh",
    adminBackToAccountSettings: "Back to Account settings",
    adminLoading: "Loading admin analytics...",
    adminLoadFailed: "Could not load admin analytics.",
    adminNotAvailable: "N/A",
    adminToday: "Today",
    adminLast7Days: "Last 7 days",
    adminLast30Days: "Last 30 days",
    adminSince: "Since {date}",
    adminGenerated: "Generated {date}",
    adminRecentRowsCapped: "Recent event rows were capped at {count}.",
    adminMetricRegisteredUsers: "Registered users",
    adminMetricActiveMemos: "Active memos",
    adminMetricDustMemos: "Dust memos",
    adminMetricFeedbackLast30Days: "Feedback, last 30 days",
    adminMetricEvents: "Events",
    adminMetricAnonymousEvents: "Anonymous events",
    adminMetricSignedInEvents: "Signed-in events",
    adminMetricAnonymousVisitors: "Anonymous visitors",
    adminMetricSignedInUsers: "Signed-in users",
    adminEventMemoSaved: "Memo saved",
    adminEventMemoCreated: "Memo created",
    adminEventMemoUpdated: "Memo updated",
    adminEventExplorerOpened: "Explorer opened",
    adminEventDustOpened: "Dust opened",
    adminEventSearchUsed: "Search used",
    adminEventFeedbackSent: "Feedback sent",
    adminEventSignInSucceeded: "Sign-in succeeded",
    saveSettings: "Save",
    msgSettingsSaving: "Saving settings...",
    msgSettingsSaved: "Settings saved.",
    msgSettingsSaveFailed: "Could not save settings. Please try again later.",
  };

export type I18nKey = keyof typeof ja;

const messages: Record<ResolvedLocale, Record<I18nKey, string>> = {
  ja,
  en,
};

export function translate(locale: ResolvedLocale, key: I18nKey): string {
  return messages[locale]?.[key] ?? messages.en[key] ?? key;
}
