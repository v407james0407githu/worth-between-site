create table if not exists public.site_state (
  site_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.site_state enable row level security;

drop policy if exists "Allow public read site_state" on public.site_state;
create policy "Allow public read site_state"
on public.site_state
for select
to anon
using (true);

insert into public.site_state (site_id, payload)
values ('primary', '{}'::jsonb)
on conflict (site_id) do nothing;
