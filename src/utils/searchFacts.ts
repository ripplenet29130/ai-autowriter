create table if not exists public.facts_cache (
  id bigserial primary key,
  keyword text not null,
  facts jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists facts_cache_keyword_idx on public.facts_cache (keyword);
create index if not exists facts_cache_created_at_idx on public.facts_cache (created_at);
