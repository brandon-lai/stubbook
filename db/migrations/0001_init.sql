-- Shared collages. The owner's own data never reaches the server; a row here
-- exists only while a collage is shared by link, and holds only what the shared
-- view shows: the title, the layout, the public ticket fields and the blurred images.

create table if not exists shares (
  token       text primary key,                 -- 22 random base62 characters, the link
  owner_hash  text not null,                    -- sha256 of the owner's device secret
  title       text not null,
  manifest    jsonb not null,                   -- tickets (fields, note, image hashes) and placements
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists share_assets (
  token        text not null references shares(token) on delete cascade,
  hash         text not null,                   -- sha256 of the bytes the owner uploaded
  bytes        bytea not null,                  -- re-encoded on the server (metadata stripped)
  content_type text not null,
  width        int not null,
  height       int not null,
  created_at   timestamptz not null default now(),
  primary key (token, hash)
);

-- Rate limiting by HMAC of the client IP; rows older than a day are pruned on write.
create table if not exists rate_events (
  key text not null,
  at  timestamptz not null default now()
);
create index if not exists rate_events_key_at on rate_events (key, at);

-- Supabase exposes tables to its REST API with the anon key; nothing here is
-- meant for that, so RLS is on with no policies (server-side access only).
alter table shares enable row level security;
alter table share_assets enable row level security;
alter table rate_events enable row level security;
