-- Stores editable system prompt versions for the RFx Responder AI persona.
-- Only one version is active at a time; the server falls back to the hardcoded
-- default when no active version exists.
create table if not exists public.prompt_versions (
  id          uuid primary key default gen_random_uuid(),
  prompt_text text not null,
  label       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  is_active   boolean not null default false
);

alter table public.prompt_versions enable row level security;

create policy "Admins manage prompt versions"
  on public.prompt_versions for all
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- Grant server-side access
grant all on public.prompt_versions to service_role;
