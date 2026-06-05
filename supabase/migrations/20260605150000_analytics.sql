-- ── 1. Add closed_at to bids ────────────────────────────────────────────────
alter table public.bids
  add column if not exists closed_at timestamptz;

-- ── 2. bid_stage_transitions ────────────────────────────────────────────────
create table if not exists public.bid_stage_transitions (
  id              uuid primary key default gen_random_uuid(),
  bid_id          uuid references public.bids(id) on delete cascade not null,
  from_stage      text,
  to_stage        text not null,
  transitioned_by uuid references public.profiles(id),
  created_at      timestamptz default now() not null
);

create index if not exists bst_bid_id_idx     on public.bid_stage_transitions (bid_id);
create index if not exists bst_created_at_idx on public.bid_stage_transitions (created_at);

alter table public.bid_stage_transitions enable row level security;

create policy "org members can read transitions"
  on public.bid_stage_transitions for select
  using (auth.uid() is not null);

create policy "org members can insert transitions"
  on public.bid_stage_transitions for insert
  with check (auth.uid() is not null);

-- ── 3. Trigger: stage changes + closed_at ──────────────────────────────────
create or replace function public.handle_bid_stage_change()
returns trigger language plpgsql security definer as $$
begin
  if (new.stage is distinct from old.stage) then
    insert into public.bid_stage_transitions (bid_id, from_stage, to_stage, transitioned_by)
    values (new.id, old.stage::text, new.stage::text, auth.uid());
  end if;

  if (new.status in ('won', 'lost') and old.status not in ('won', 'lost')) then
    new.closed_at := now();
  end if;

  if (old.status in ('won', 'lost') and new.status not in ('won', 'lost')) then
    new.closed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists bid_stage_change_trigger on public.bids;
create trigger bid_stage_change_trigger
  before update on public.bids
  for each row execute function public.handle_bid_stage_change();

-- ── 4. RPC: analytics_kpi_summary ──────────────────────────────────────────
create or replace function public.analytics_kpi_summary(p_from timestamptz, p_to timestamptz)
returns table (
  active_bids    bigint,
  pipeline_value numeric,
  win_rate       numeric,
  avg_cycle_days numeric,
  closed_count   bigint,
  won_count      bigint,
  lost_count     bigint
) language sql security definer as $$
  select
    count(*)                      filter (where status = 'active')                                              as active_bids,
    coalesce(sum(value)           filter (where status = 'active'), 0)                                          as pipeline_value,
    case
      when count(*) filter (where status in ('won','lost') and closed_at between p_from and p_to) > 0
        then round(
          count(*) filter (where status = 'won'  and closed_at between p_from and p_to)::numeric /
          count(*) filter (where status in ('won','lost') and closed_at between p_from and p_to) * 100, 1)
      else 0
    end                                                                                                          as win_rate,
    round(avg(extract(epoch from (closed_at - created_at)) / 86400)
          filter (where status in ('won','lost') and closed_at between p_from and p_to)::numeric, 1)            as avg_cycle_days,
    count(*) filter (where status in ('won','lost') and closed_at between p_from and p_to)                      as closed_count,
    count(*) filter (where status = 'won'  and closed_at between p_from and p_to)                               as won_count,
    count(*) filter (where status = 'lost' and closed_at between p_from and p_to)                               as lost_count
  from public.bids;
$$;

-- ── 5. RPC: analytics_win_rate_trend ────────────────────────────────────────
create or replace function public.analytics_win_rate_trend(p_from timestamptz, p_to timestamptz)
returns table (
  month        date,
  won_count    bigint,
  closed_count bigint,
  win_rate     numeric
) language sql security definer as $$
  select
    date_trunc('month', closed_at)::date                                                                as month,
    count(*) filter (where status = 'won')                                                              as won_count,
    count(*)                                                                                             as closed_count,
    case when count(*) > 0
      then round(count(*) filter (where status = 'won')::numeric / count(*) * 100, 1)
      else 0
    end                                                                                                  as win_rate
  from public.bids
  where status in ('won','lost')
    and closed_at between p_from and p_to
  group by date_trunc('month', closed_at)
  order by month;
$$;

-- ── 6. RPC: analytics_stage_distribution ────────────────────────────────────
create or replace function public.analytics_stage_distribution()
returns table (
  stage     text,
  bid_count bigint,
  pct       numeric
) language sql security definer as $$
  with totals as (select count(*) as total from public.bids where status = 'active')
  select
    b.stage::text,
    count(*)                                                                            as bid_count,
    case when t.total > 0 then round(count(*)::numeric / t.total * 100, 1) else 0 end  as pct
  from public.bids b, totals t
  where b.status = 'active'
  group by b.stage, t.total
  order by bid_count desc;
$$;

-- ── 7. RPC: analytics_pipeline_value_by_stage ───────────────────────────────
create or replace function public.analytics_pipeline_value_by_stage()
returns table (
  stage       text,
  total_value numeric
) language sql security definer as $$
  select stage::text, coalesce(sum(value), 0) as total_value
  from public.bids
  where status = 'active'
  group by stage
  order by total_value desc;
$$;

-- ── 8. RPC: analytics_cycle_time_by_stage ───────────────────────────────────
create or replace function public.analytics_cycle_time_by_stage(p_from timestamptz, p_to timestamptz)
returns table (
  stage    text,
  avg_days numeric
) language sql security definer as $$
  with durations as (
    select
      to_stage,
      extract(epoch from (
        coalesce(
          lead(created_at) over (partition by bid_id order by created_at),
          now()
        ) - created_at
      )) / 86400 as days_in_stage
    from public.bid_stage_transitions
    where created_at between p_from and p_to
  )
  select
    to_stage                              as stage,
    round(avg(days_in_stage)::numeric, 1) as avg_days
  from durations
  group by to_stage
  order by avg_days desc;
$$;

-- ── 9. RPC: analytics_won_lost_by_month ─────────────────────────────────────
create or replace function public.analytics_won_lost_by_month(p_from timestamptz, p_to timestamptz)
returns table (
  month      date,
  won_value  numeric,
  lost_value numeric
) language sql security definer as $$
  select
    date_trunc('month', closed_at)::date                              as month,
    coalesce(sum(value) filter (where status = 'won'),  0)            as won_value,
    coalesce(sum(value) filter (where status = 'lost'), 0)            as lost_value
  from public.bids
  where status in ('won','lost')
    and closed_at between p_from and p_to
  group by date_trunc('month', closed_at)
  order by month;
$$;

-- ── 10. RPC: analytics_monthly_intake ───────────────────────────────────────
create or replace function public.analytics_monthly_intake(p_from timestamptz, p_to timestamptz)
returns table (
  month    date,
  new_bids bigint
) language sql security definer as $$
  select
    date_trunc('month', created_at)::date as month,
    count(*)                              as new_bids
  from public.bids
  where created_at between p_from and p_to
  group by date_trunc('month', created_at)
  order by month;
$$;

-- ── 11. RPC: analytics_team_performance ─────────────────────────────────────
create or replace function public.analytics_team_performance(p_from timestamptz, p_to timestamptz)
returns table (
  user_id        uuid,
  display_name   text,
  avatar_url     text,
  active_bids    bigint,
  closed_count   bigint,
  won_count      bigint,
  win_rate       numeric,
  pipeline_value numeric,
  avg_cycle_days numeric
) language sql security definer as $$
  select
    p.id                                                                                        as user_id,
    p.full_name                                                                                 as display_name,
    p.avatar_url,
    count(*) filter (where b.status = 'active')                                                as active_bids,
    count(*) filter (where b.status in ('won','lost') and b.closed_at between p_from and p_to) as closed_count,
    count(*) filter (where b.status = 'won'  and b.closed_at between p_from and p_to)          as won_count,
    case
      when count(*) filter (where b.status in ('won','lost') and b.closed_at between p_from and p_to) > 0
        then round(
          count(*) filter (where b.status = 'won' and b.closed_at between p_from and p_to)::numeric /
          count(*) filter (where b.status in ('won','lost') and b.closed_at between p_from and p_to) * 100, 1)
      else 0
    end                                                                                         as win_rate,
    coalesce(sum(b.value) filter (where b.status = 'active'), 0)                               as pipeline_value,
    round(avg(extract(epoch from (b.closed_at - b.created_at)) / 86400)
          filter (where b.status in ('won','lost') and b.closed_at between p_from and p_to)::numeric, 1)
                                                                                                as avg_cycle_days
  from public.profiles p
  left join public.bids b on b.owner_id = p.id
  group by p.id, p.full_name, p.avatar_url
  having count(b.id) > 0
  order by win_rate desc nulls last;
$$;
