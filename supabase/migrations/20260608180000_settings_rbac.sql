-- 1. profiles.status
alter table public.profiles
  add column if not exists status text not null default 'pending'
  check (status in ('pending', 'active', 'suspended'));

-- Backfill all existing profiles to 'active'
update public.profiles set status = 'active' where status = 'pending';

-- 2. role_permissions
create table if not exists public.role_permissions (
  id            uuid primary key default gen_random_uuid(),
  role          text not null check (role in ('pre_sales', 'legal', 'finance')),
  resource_type text not null check (resource_type in ('page', 'feature')),
  resource_key  text not null,
  allowed       boolean not null default true,
  updated_by    uuid references public.profiles(id),
  updated_at    timestamptz default now(),
  unique (role, resource_key)
);

alter table public.role_permissions enable row level security;
create policy "admins_all_role_permissions" on public.role_permissions
  for all using (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );
create policy "users_read_own_role_permissions" on public.role_permissions
  for select using (
    role = (select r.role from public.user_roles r where r.user_id = auth.uid() limit 1)
  );

-- Seed defaults
insert into public.role_permissions (role, resource_type, resource_key, allowed) values
  ('pre_sales','page','page:dashboard',true),
  ('pre_sales','page','page:pipeline',true),
  ('pre_sales','page','page:queue',true),
  ('pre_sales','page','page:analytics',true),
  ('pre_sales','page','page:ai',true),
  ('pre_sales','page','page:docs',true),
  ('pre_sales','page','page:calendar',true),
  ('pre_sales','page','page:notifications',true),
  ('pre_sales','feature','feature:docs:upload',true),
  ('pre_sales','feature','feature:docs:delete',true),
  ('pre_sales','feature','feature:docs:reindex',true),
  ('pre_sales','feature','feature:bids:create',true),
  ('pre_sales','feature','feature:bids:delete',false),
  ('pre_sales','feature','feature:analytics:export',true),
  ('pre_sales','feature','feature:ai:model-select',true),
  ('legal','page','page:dashboard',true),
  ('legal','page','page:pipeline',true),
  ('legal','page','page:queue',true),
  ('legal','page','page:analytics',false),
  ('legal','page','page:ai',false),
  ('legal','page','page:docs',true),
  ('legal','page','page:calendar',true),
  ('legal','page','page:notifications',true),
  ('legal','feature','feature:docs:upload',false),
  ('legal','feature','feature:docs:delete',false),
  ('legal','feature','feature:docs:reindex',false),
  ('legal','feature','feature:bids:create',false),
  ('legal','feature','feature:bids:delete',false),
  ('legal','feature','feature:analytics:export',false),
  ('legal','feature','feature:ai:model-select',false),
  ('finance','page','page:dashboard',true),
  ('finance','page','page:pipeline',true),
  ('finance','page','page:queue',true),
  ('finance','page','page:analytics',true),
  ('finance','page','page:ai',false),
  ('finance','page','page:docs',false),
  ('finance','page','page:calendar',true),
  ('finance','page','page:notifications',true),
  ('finance','feature','feature:docs:upload',false),
  ('finance','feature','feature:docs:delete',false),
  ('finance','feature','feature:docs:reindex',false),
  ('finance','feature','feature:bids:create',false),
  ('finance','feature','feature:bids:delete',false),
  ('finance','feature','feature:analytics:export',true),
  ('finance','feature','feature:ai:model-select',false)
on conflict (role, resource_key) do nothing;

-- 3. bid_assignments
create table if not exists public.bid_assignments (
  id          uuid primary key default gen_random_uuid(),
  bid_id      uuid not null references public.bids(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz default now(),
  unique (bid_id, user_id)
);

alter table public.bid_assignments enable row level security;
create policy "admins_manage_bid_assignments" on public.bid_assignments
  for all using (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );
create policy "users_read_bid_assignments" on public.bid_assignments
  for select using (auth.uid() is not null);

-- 4. org_settings
create table if not exists public.org_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz default now()
);

alter table public.org_settings enable row level security;
create policy "admins_all_org_settings" on public.org_settings
  for all using (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );

insert into public.org_settings (key, value) values
  ('hubspot_token',       '{"token": null}'),
  ('hubspot_stage_map',   '{"mappings": []}'),
  ('hubspot_last_synced', '{"at": null, "created": 0, "updated": 0, "errors": 0}')
on conflict (key) do nothing;
