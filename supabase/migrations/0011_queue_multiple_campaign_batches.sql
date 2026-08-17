-- Queues several ready Smart Batches in one transaction. If any selected
-- batch cannot be queued, none of them are queued, avoiding partial "send all"
-- operations.

create or replace function public.queue_campaign_batches(
  p_campaign_id uuid,
  p_batch_ids uuid[],
  p_scheduled_at timestamptz default null,
  p_timezone text default 'UTC',
  p_max_attempts integer default 3
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_batch_id uuid;
  batch_result jsonb;
  queued_count integer := 0;
  queued_batch_ids uuid[] := '{}';
  skipped_batch_ids uuid[] := '{}';
begin
  if coalesce(array_length(p_batch_ids, 1), 0) = 0 then
    raise exception 'Select at least one ready batch';
  end if;
  if array_length(p_batch_ids, 1) > 200 then
    raise exception 'No more than 200 batches can be queued at once';
  end if;

  for selected_batch_id in
    select input.batch_id
    from unnest(p_batch_ids) with ordinality as input(batch_id, position)
    group by input.batch_id
    order by min(input.position)
  loop
    begin
      batch_result := public.queue_campaign_batch(
        p_campaign_id,
        selected_batch_id,
        p_scheduled_at,
        p_timezone,
        p_max_attempts
      );
    exception
      when others then
        if sqlerrm = 'No new eligible contacts are available in this batch' then
          -- A reusable batch may overlap one already sent by this campaign.
          -- Treat a fully duplicated batch as processed instead of rolling
          -- back every other selected batch.
          update public.campaign_batches
          set status = 'completed', completed_at = timezone('utc', now())
          where user_id = auth.uid()
            and campaign_id = p_campaign_id
            and batch_id = selected_batch_id
            and status = 'ready';
          skipped_batch_ids := array_append(skipped_batch_ids, selected_batch_id);
          continue;
        end if;
        raise;
    end;
    queued_count :=
      queued_count + coalesce((batch_result ->> 'queued')::integer, 0);
    queued_batch_ids := array_append(queued_batch_ids, selected_batch_id);
  end loop;

  return jsonb_build_object(
    'batch_ids', to_jsonb(queued_batch_ids),
    'batches_queued', array_length(queued_batch_ids, 1),
    'skipped_batch_ids', to_jsonb(skipped_batch_ids),
    'batches_skipped', coalesce(array_length(skipped_batch_ids, 1), 0),
    'queued', queued_count,
    'status', case when p_scheduled_at is null then 'processing' else 'scheduled' end
  );
end;
$$;

grant execute on function public.queue_campaign_batches(
  uuid, uuid[], timestamptz, text, integer
) to authenticated;
