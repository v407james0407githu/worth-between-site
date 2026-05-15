create table if not exists public.site_state (
  site_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.site_state enable row level security;

create policy "Allow public read site_state"
on public.site_state
for select
to anon
using (true);

create policy "Allow public upsert site_state"
on public.site_state
for insert
to anon
with check (true);

create policy "Allow public update site_state"
on public.site_state
for update
to anon
using (true)
with check (true);

insert into public.site_state (site_id, payload)
values ('primary', '{}'::jsonb)
on conflict (site_id) do nothing;
