create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    privacy_version,
    locale_preference,
    resolved_locale
  )
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      nullif(
        btrim(
          concat_ws(
            ' ',
            new.raw_user_meta_data->>'family_name',
            new.raw_user_meta_data->>'given_name'
          )
        ),
        ''
      ),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'TypingNote user'
    ),
    nullif(btrim(new.raw_user_meta_data->>'family_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'given_name'), ''),
    nullif(new.raw_user_meta_data->>'agreed_terms_at', '')::timestamptz,
    nullif(btrim(new.raw_user_meta_data->>'terms_version'), ''),
    nullif(new.raw_user_meta_data->>'agreed_privacy_at', '')::timestamptz,
    nullif(btrim(new.raw_user_meta_data->>'privacy_version'), ''),
    case
      when nullif(btrim(new.raw_user_meta_data->>'locale_preference'), '')
        in ('auto', 'ja', 'en')
        then nullif(btrim(new.raw_user_meta_data->>'locale_preference'), '')
      else 'auto'
    end,
    case
      when nullif(btrim(new.raw_user_meta_data->>'resolved_locale'), '')
        in ('ja', 'en')
        then nullif(btrim(new.raw_user_meta_data->>'resolved_locale'), '')
      else 'en'
    end
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
        locale_preference  = coalesce(excluded.locale_preference, public.profiles.locale_preference),
        resolved_locale    = coalesce(excluded.resolved_locale, public.profiles.resolved_locale),
        updated_at         = now();

  return new;
end;
$$;
