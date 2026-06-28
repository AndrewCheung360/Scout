-- Scout — initial schema (Phase 0).
-- Mirrors the data model in the plan; the accumulating data layer (catalog/offers/
-- price_history/sources) is the long-term asset (ADR-0003).
-- gen_random_uuid() is core Postgres (>=13). pgvector (chat-RAG) is added in 0002,
-- where the extension is available (Supabase has it built in).

-- identity
create table users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  created_at  timestamptz not null default now()
);

-- catalog: canonical products + cross-retailer offers + price history
create table products (
  id             uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  brand          text,
  category_guess text,
  identifiers    jsonb not null default '{}'::jsonb,  -- {gtin,upc,mpn,asin}
  attributes     jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index products_identifiers_gin on products using gin (identifiers);

create table offers (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references products(id) on delete cascade,
  retailer         text not null,
  url              text not null,
  affiliate_url    text,
  price            numeric(12,2),
  currency         text not null default 'USD',
  in_stock         boolean,
  stock_level      int,
  match_confidence text not null default 'low',  -- 'high' | 'low' (G2)
  fetched_at       timestamptz not null default now()
);
create index offers_product_idx on offers (product_id);

-- append-only price time series (feeds watches + sparklines)
create table price_history (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references products(id) on delete cascade,
  retailer    text not null,
  price       numeric(12,2),
  currency    text not null default 'USD',
  in_stock    boolean,
  observed_at timestamptz not null default now()
);
create index price_history_product_time_idx on price_history (product_id, observed_at desc);

-- research: reports + cited, credibility-scored sources
create table reports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id) on delete set null,
  raw_intent      text not null,
  parsed_criteria jsonb not null default '{}'::jsonb,
  status          text not null default 'complete',
  confidence      text,                              -- High | Medium | Low (ADR-0004)
  summary         text,
  recommendations jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create table sources (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid references reports(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  url         text not null,
  type        text,                                  -- retailer|editorial|youtube|forum|reddit
  credibility real,
  flags       jsonb not null default '[]'::jsonb,    -- factual signals (ADR-0004)
  evidence    jsonb not null default '{}'::jsonb,    -- why each flag fired
  snippet     text,
  fetched_at  timestamptz not null default now()
);
create index sources_report_idx on sources (report_id);
-- (sources.embedding vector(768) is added in 0002_pgvector.sql for the chat dock, Phase 3)

-- watch: standing interests + fired alerts
create table watches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  rules       jsonb not null default '[]'::jsonb,
  channel     text not null default 'email',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index watches_active_idx on watches (active) where active;

create table alerts (
  id           uuid primary key default gen_random_uuid(),
  watch_id     uuid not null references watches(id) on delete cascade,
  reason       jsonb not null,
  payload      jsonb not null default '{}'::jsonb,
  triggered_at timestamptz not null default now(),
  delivered_at timestamptz
);

-- chat dock: follow-up Q&A grounded in a report's sources (G4)
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references reports(id) on delete cascade,
  user_id    uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null,                     -- user | assistant
  content         text not null,
  created_at      timestamptz not null default now()
);
create index messages_conversation_idx on messages (conversation_id, created_at);
