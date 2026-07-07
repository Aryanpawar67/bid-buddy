-- ── Phase 1: Contract & Legal tab real data ───────────────────────────────────

-- 1. Real approval workflow table (one row per bid × stage)
create table if not exists public.contract_approvals (
  id          uuid primary key default gen_random_uuid(),
  bid_id      uuid not null references public.bids(id) on delete cascade,
  stage       text not null check (stage in ('legal','commercial','finance','executive')),
  status      text not null default 'pending'
              check (status in ('pending','approved','rejected')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  notes       text,
  created_at  timestamptz default now(),
  unique (bid_id, stage)
);

alter table public.contract_approvals enable row level security;

create policy "auth_read_contract_approvals" on public.contract_approvals
  for select using (auth.uid() is not null);

-- Legal role may action their own stage; finance theirs; admin all
create policy "legal_action_legal_approval" on public.contract_approvals
  for update using (
    stage = 'legal'
    and exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role in ('legal','admin')
    )
  );

create policy "finance_action_finance_approval" on public.contract_approvals
  for update using (
    stage = 'finance'
    and exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role in ('finance','admin')
    )
  );

create policy "admin_action_any_approval" on public.contract_approvals
  for all using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- Pre-sales + all roles can insert (used by useEnsureApprovals on stage entry)
create policy "auth_insert_contract_approvals" on public.contract_approvals
  for insert with check (auth.uid() is not null);

-- 2. Document category on bid_documents
alter table public.bid_documents
  add column if not exists doc_category text default 'reference'
    check (doc_category in ('draft','redline','final','reference','supporting'));
