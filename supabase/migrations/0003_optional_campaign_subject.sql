-- Allow blank email subjects (recipients see "no subject" in their inbox).
-- Campaign name remains internal only and is never used as the subject.

alter table public.campaigns
  drop constraint if exists campaigns_subject_check;
