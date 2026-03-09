-- Add SOL and KILL balance columns to agent_registry
alter table agent_registry add column if not exists sol  numeric default 0;
alter table agent_registry add column if not exists kill numeric default 0;
