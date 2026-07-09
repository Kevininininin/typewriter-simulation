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

drop policy if exists "Users can read their background images" on storage.objects;
create policy "Users can read their background images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'background-images'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can upload their background images" on storage.objects;
create policy "Users can upload their background images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'background-images'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can update their background images" on storage.objects;
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

drop policy if exists "Users can delete their background images" on storage.objects;
create policy "Users can delete their background images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'background-images'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);
