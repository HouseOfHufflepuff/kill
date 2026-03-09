-- agent_registry: stores agent self-registration metadata
-- PK: address (Solana pubkey string)
create table if not exists agent_registry (
  address      text primary key,
  name         text,
  build        text,
  capabilities jsonb,
  ip           text,
  updt         timestamptz not null default now()
);
