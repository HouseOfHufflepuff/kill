-- Add total_burned column to killed table (new KillEvent field)
alter table killed add column if not exists total_burned numeric not null default 0;
