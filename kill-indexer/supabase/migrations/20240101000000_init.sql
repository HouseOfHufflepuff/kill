-- Immutable event log: one row per StackSpawned event
create table spawned (
  id            text primary key,
  agent         text not null,
  stack_id      numeric not null,
  units         numeric not null,
  reapers       numeric not null,
  birth_slot    bigint not null,
  slot          bigint not null
);

-- Immutable event log: one row per StackMoved event
create table moved (
  id            text primary key,
  agent         text not null,
  from_stack    numeric not null,
  to_stack      numeric not null,
  units         numeric not null,
  reaper        numeric not null,
  birth_slot    bigint not null,
  slot          bigint not null
);

-- Immutable event log: one row per KillEvent
create table killed (
  id                      text primary key,
  attacker                text not null,
  target                  text not null,
  stack_id                numeric not null,
  attacker_units_sent     numeric not null,
  attacker_reaper_sent    numeric not null,
  attacker_units_lost     numeric not null,
  attacker_reaper_lost    numeric not null,
  target_units_lost       numeric not null,
  target_reaper_lost      numeric not null,
  initial_defender_units  numeric not null,
  initial_defender_reaper numeric not null,
  attacker_bounty         numeric not null,
  defender_bounty         numeric not null,
  target_birth_slot       bigint not null,
  slot                    bigint not null
);

-- Mutable: current state of each stack
create table stack (
  id                   text primary key,
  total_standard_units numeric not null default 0,
  total_boosted_units  numeric not null default 0,
  birth_slot           bigint not null default 0,
  current_bounty       numeric not null default 0,
  active               boolean not null default false
);

-- Mutable: units an agent holds in a specific stack
create table agent_stack (
  id         text primary key,
  agent      text not null,
  stack_id   numeric not null,
  birth_slot bigint not null default 0,
  units      numeric not null default 0,
  reaper     numeric not null default 0
);

-- Mutable: per-wallet financials
create table agent (
  id                text primary key,
  total_spent       numeric not null default 0,
  total_earned      numeric not null default 0,
  net_pnl           numeric not null default 0,
  last_active_slot  bigint not null default 0
);

-- Mutable: single-row global stats (id = 'current')
create table global_stat (
  id                  text primary key,
  total_units_killed  numeric not null default 0,
  total_reaper_killed numeric not null default 0,
  kill_added          numeric not null default 0,
  kill_extracted      numeric not null default 0,
  kill_burned         numeric not null default 0,
  total_pnl           numeric not null default 0,
  current_treasury    numeric not null default 0,
  max_bounty          numeric not null default 0
);
