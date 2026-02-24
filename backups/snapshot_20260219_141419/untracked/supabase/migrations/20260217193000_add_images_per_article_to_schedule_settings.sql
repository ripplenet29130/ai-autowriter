alter table public.schedule_settings
add column if not exists images_per_article integer not null default 0;

alter table public.schedule_settings
drop constraint if exists schedule_settings_images_per_article_check;

alter table public.schedule_settings
add constraint schedule_settings_images_per_article_check
check (images_per_article >= 0 and images_per_article <= 10);
