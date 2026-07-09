create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  background_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists background_settings jsonb not null default '{}'::jsonb;

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.pages enable row level security;

create policy "Users can read their profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "Users can create their profile"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "Users can update their profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Users can read their pages"
on public.pages
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their pages"
on public.pages
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their pages"
on public.pages
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their pages"
on public.pages
for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists pages_user_updated_idx
on public.pages (user_id, updated_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'background-images',
  'background-images',
  false,
  5242880,
  array['image/png', 'image/jpeg']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can read their background images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'background-images'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

create policy "Users can upload their background images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'background-images'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

create policy "Users can update their background images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'background-images'
  and (select auth.uid())::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'background-images'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

create policy "Users can delete their background images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'background-images'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);
