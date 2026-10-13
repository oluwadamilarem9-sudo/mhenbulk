-- Allow a sending account to use MisarMail.
-- Existing provider values and existing account rows are left unchanged.

alter type public.email_account_provider add value if not exists 'misarmail';
