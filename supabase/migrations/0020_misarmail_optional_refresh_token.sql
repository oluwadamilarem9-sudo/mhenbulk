-- MisarMail accounts store an encrypted API key and have no OAuth refresh token.
-- Existing Gmail rows keep the refresh token already stored in this column.

alter table public.email_account_credentials
  alter column encrypted_refresh_token drop not null;
