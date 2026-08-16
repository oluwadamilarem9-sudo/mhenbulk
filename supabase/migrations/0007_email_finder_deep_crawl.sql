-- Email Finder deep-crawl enrichment: confidence, multi-source, domain, custom paths.
-- Additive only — existing scans, batches, contacts, and campaigns stay intact.

-- ---------------------------------------------------------------------------
-- Result enrichment
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_finder_confidence') then
    create type public.email_finder_confidence as enum ('high', 'medium', 'low');
  end if;
end
$$;

alter table public.email_finder_results
  add column if not exists domain text,
  add column if not exists source_page_title text,
  add column if not exists source_urls text[] not null default '{}',
  add column if not exists confidence public.email_finder_confidence not null default 'medium',
  add column if not exists methods text[] not null default '{}';

update public.email_finder_results
set domain = split_part(email_normalized, '@', 2)
where domain is null or btrim(domain) = '';

update public.email_finder_results
set source_urls = array[source_url]
where coalesce(array_length(source_urls, 1), 0) = 0
  and source_url is not null
  and btrim(source_url) <> '';

alter table public.email_finder_results
  alter column domain set not null;

create index if not exists email_finder_results_confidence_idx
  on public.email_finder_results (scan_id, confidence);

create index if not exists email_finder_results_domain_idx
  on public.email_finder_results (user_id, domain);

-- ---------------------------------------------------------------------------
-- Batch scan options (custom paths + owner-grade preference)
-- ---------------------------------------------------------------------------

alter table public.email_finder_batches
  add column if not exists custom_paths text[] not null default '{}',
  add column if not exists owner_grade_only boolean not null default false,
  add column if not exists deep_crawl boolean not null default true;

-- ---------------------------------------------------------------------------
-- Contacts: allow blank names for finder-sourced rows (never invent people)
-- ---------------------------------------------------------------------------

alter table public.contacts
  drop constraint if exists contacts_first_name_check;

alter table public.contacts
  drop constraint if exists contacts_last_name_check;

alter table public.contacts
  alter column first_name set default '';

alter table public.contacts
  alter column last_name set default '';

alter table public.contacts
  add constraint contacts_first_name_check
  check (char_length(first_name) >= 0);

alter table public.contacts
  add constraint contacts_last_name_check
  check (char_length(last_name) >= 0);
