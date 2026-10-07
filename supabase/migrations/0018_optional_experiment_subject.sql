-- A/B variants may be saved with a blank subject.
-- Existing rows are left as they are. The message body is still required.

alter table public.campaign_experiment_variants
  drop constraint if exists campaign_experiment_variants_subject_check;

alter table public.campaign_experiment_variants
  add constraint campaign_experiment_variants_subject_check
  check (char_length(subject) <= 300);
