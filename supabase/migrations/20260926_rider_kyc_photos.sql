-- Ghana Card KYC: store photo URLs instead of (or in addition to) typed card numbers.
-- Run in Supabase SQL editor if not using CLI migrations.

alter table public.riders
  add column if not exists ghana_card_front_url text,
  add column if not exists ghana_card_back_url text;

comment on column public.riders.ghana_card_front_url is 'Public or signed URL to Ghana Card front image';
comment on column public.riders.ghana_card_back_url is 'Public or signed URL to Ghana Card back image';

-- Public read so rider profile selfie URLs work in the app; uploads only via add-rider (service role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rider-kyc',
  'rider-kyc',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
