


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (
    id,
    email,
    display_name,
    family_name,
    given_name,
    agreed_terms_at,
    terms_version,
    agreed_privacy_at,
    privacy_version
  )
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
      nullif(
        btrim(
          concat_ws(' ', new.raw_user_meta_data->>'family_name', new.raw_user_meta_data->>'given_name')
        ),
        ''
      )
    ),
    nullif(btrim(new.raw_user_meta_data->>'family_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'given_name'), ''),
    nullif(new.raw_user_meta_data->>'agreed_terms_at', '')::timestamptz,
    nullif(btrim(new.raw_user_meta_data->>'terms_version'), ''),
    nullif(new.raw_user_meta_data->>'agreed_privacy_at', '')::timestamptz,
    nullif(btrim(new.raw_user_meta_data->>'privacy_version'), '')
  )
  on conflict (id) do update
    set email              = excluded.email,
        display_name       = coalesce(excluded.display_name, public.profiles.display_name),
        family_name        = coalesce(excluded.family_name, public.profiles.family_name),
        given_name         = coalesce(excluded.given_name, public.profiles.given_name),
        agreed_terms_at    = coalesce(excluded.agreed_terms_at, public.profiles.agreed_terms_at),
        terms_version      = coalesce(excluded.terms_version, public.profiles.terms_version),
        agreed_privacy_at  = coalesce(excluded.agreed_privacy_at, public.profiles.agreed_privacy_at),
        privacy_version    = coalesce(excluded.privacy_version, public.profiles.privacy_version),
        updated_at         = now();

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."account_email_otp_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "account_email_id" "uuid",
    "normalized_email" "text" NOT NULL,
    "purpose" "text" NOT NULL,
    "otp_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 5 NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "account_email_otp_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "account_email_otp_max_attempts_check" CHECK ((("max_attempts" >= 1) AND ("max_attempts" <= 20))),
    CONSTRAINT "account_email_otp_purpose_check" CHECK (("purpose" = ANY (ARRAY['verify_email'::"text", 'step_up'::"text", 'change_email'::"text", 'change_password'::"text"])))
);


ALTER TABLE "public"."account_email_otp_challenges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "normalized_email" "text" GENERATED ALWAYS AS ("lower"("btrim"("email"))) STORED,
    "is_verified" boolean DEFAULT false NOT NULL,
    "use_for_2fa" boolean DEFAULT false NOT NULL,
    "use_for_recovery" boolean DEFAULT true NOT NULL,
    "use_for_notification" boolean DEFAULT false NOT NULL,
    "verified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."account_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_trusted_browsers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "browser_secret_hash" "text" NOT NULL,
    "label" "text",
    "last_verified_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."account_trusted_browsers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."memos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."memos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."password_reset_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "normalized_email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."password_reset_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "display_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "family_name" "text",
    "given_name" "text",
    "agreed_terms_at" timestamp with time zone,
    "terms_version" "text",
    "agreed_privacy_at" timestamp with time zone,
    "privacy_version" "text",
    "locale_preference" "text" DEFAULT 'auto'::"text" NOT NULL,
    "resolved_locale" "text" DEFAULT 'en'::"text" NOT NULL,
    CONSTRAINT "profiles_display_name_not_blank_chk" CHECK ((("display_name" IS NULL) OR ("char_length"("btrim"("display_name")) > 0))),
    CONSTRAINT "profiles_family_name_not_blank_chk" CHECK ((("family_name" IS NULL) OR ("char_length"("btrim"("family_name")) > 0))),
    CONSTRAINT "profiles_given_name_not_blank_chk" CHECK ((("given_name" IS NULL) OR ("char_length"("btrim"("given_name")) > 0))),
    CONSTRAINT "profiles_locale_preference_check" CHECK (("locale_preference" = ANY (ARRAY['auto'::"text", 'ja'::"text", 'en'::"text"]))),
    CONSTRAINT "profiles_privacy_pair_chk" CHECK (((("agreed_privacy_at" IS NULL) AND ("privacy_version" IS NULL)) OR (("agreed_privacy_at" IS NOT NULL) AND ("privacy_version" IS NOT NULL)))),
    CONSTRAINT "profiles_resolved_locale_check" CHECK (("resolved_locale" = ANY (ARRAY['ja'::"text", 'en'::"text"]))),
    CONSTRAINT "profiles_terms_pair_chk" CHECK (((("agreed_terms_at" IS NULL) AND ("terms_version" IS NULL)) OR (("agreed_terms_at" IS NOT NULL) AND ("terms_version" IS NOT NULL))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."account_email_otp_challenges"
    ADD CONSTRAINT "account_email_otp_challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."account_emails"
    ADD CONSTRAINT "account_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."account_trusted_browsers"
    ADD CONSTRAINT "account_trusted_browsers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."account_trusted_browsers"
    ADD CONSTRAINT "account_trusted_browsers_user_hash_unique" UNIQUE ("user_id", "browser_secret_hash");



ALTER TABLE ONLY "public"."memos"
    ADD CONSTRAINT "memos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."password_reset_requests"
    ADD CONSTRAINT "password_reset_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



CREATE INDEX "account_email_otp_account_email_lookup_idx" ON "public"."account_email_otp_challenges" USING "btree" ("user_id", "purpose", "account_email_id", "created_at" DESC);



CREATE INDEX "account_email_otp_email_lookup_idx" ON "public"."account_email_otp_challenges" USING "btree" ("user_id", "purpose", "normalized_email", "created_at" DESC);



CREATE INDEX "account_email_otp_expires_at_idx" ON "public"."account_email_otp_challenges" USING "btree" ("expires_at");



CREATE INDEX "account_email_otp_user_id_idx" ON "public"."account_email_otp_challenges" USING "btree" ("user_id");



CREATE UNIQUE INDEX "account_emails_normalized_email_unique" ON "public"."account_emails" USING "btree" ("normalized_email");



CREATE UNIQUE INDEX "account_emails_user_email_unique" ON "public"."account_emails" USING "btree" ("user_id", "normalized_email");



CREATE INDEX "account_emails_user_id_idx" ON "public"."account_emails" USING "btree" ("user_id");



CREATE INDEX "account_trusted_browsers_last_verified_at_idx" ON "public"."account_trusted_browsers" USING "btree" ("user_id", "last_verified_at" DESC);



CREATE INDEX "account_trusted_browsers_user_id_idx" ON "public"."account_trusted_browsers" USING "btree" ("user_id");



CREATE INDEX "idx_memos_user_deleted_created" ON "public"."memos" USING "btree" ("user_id", "deleted_at", "created_at" DESC);



CREATE INDEX "idx_memos_user_deleted_updated" ON "public"."memos" USING "btree" ("user_id", "deleted_at", "updated_at" DESC);



CREATE INDEX "idx_profiles_email" ON "public"."profiles" USING "btree" ("email");



CREATE INDEX "memos_user_deleted_at_idx" ON "public"."memos" USING "btree" ("user_id", "deleted_at");



CREATE INDEX "memos_user_id_created_at_idx" ON "public"."memos" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "password_reset_requests_email_created_at_idx" ON "public"."password_reset_requests" USING "btree" ("normalized_email", "created_at" DESC);



CREATE OR REPLACE TRIGGER "set_account_emails_updated_at" BEFORE UPDATE ON "public"."account_emails" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_account_trusted_browsers_updated_at" BEFORE UPDATE ON "public"."account_trusted_browsers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_updated_at" BEFORE UPDATE ON "public"."memos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."account_email_otp_challenges"
    ADD CONSTRAINT "account_email_otp_challenges_account_email_id_fkey" FOREIGN KEY ("account_email_id") REFERENCES "public"."account_emails"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_email_otp_challenges"
    ADD CONSTRAINT "account_email_otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_emails"
    ADD CONSTRAINT "account_emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_trusted_browsers"
    ADD CONSTRAINT "account_trusted_browsers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."memos"
    ADD CONSTRAINT "memos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Users can delete own account emails" ON "public"."account_emails" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."account_email_otp_challenges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."account_emails" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "account_emails_select_own" ON "public"."account_emails" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."account_trusted_browsers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "account_trusted_browsers_select_own" ON "public"."account_trusted_browsers" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."memos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "memos_delete_own" ON "public"."memos" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "memos_insert_own" ON "public"."memos" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "memos_select_own" ON "public"."memos" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "memos_update_own" ON "public"."memos" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."password_reset_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."account_email_otp_challenges" TO "anon";
GRANT ALL ON TABLE "public"."account_email_otp_challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."account_email_otp_challenges" TO "service_role";



GRANT ALL ON TABLE "public"."account_emails" TO "anon";
GRANT ALL ON TABLE "public"."account_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."account_emails" TO "service_role";



GRANT ALL ON TABLE "public"."account_trusted_browsers" TO "anon";
GRANT ALL ON TABLE "public"."account_trusted_browsers" TO "authenticated";
GRANT ALL ON TABLE "public"."account_trusted_browsers" TO "service_role";



GRANT ALL ON TABLE "public"."memos" TO "anon";
GRANT ALL ON TABLE "public"."memos" TO "authenticated";
GRANT ALL ON TABLE "public"."memos" TO "service_role";



GRANT ALL ON TABLE "public"."password_reset_requests" TO "anon";
GRANT ALL ON TABLE "public"."password_reset_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."password_reset_requests" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







