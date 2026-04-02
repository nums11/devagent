insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'proof-videos',
  'proof-videos',
  true,
  524288000,
  array['video/mp4', 'video/quicktime', 'video/x-m4v']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
