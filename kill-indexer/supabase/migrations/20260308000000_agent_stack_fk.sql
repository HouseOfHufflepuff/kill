-- Change agent_stack.stack_id from numeric to text to match stack.id type.
-- Then add FK so Supabase pg_graphql exposes agentStackCollection nested
-- under stackCollection without any extra viewer code.

ALTER TABLE agent_stack
  ALTER COLUMN stack_id TYPE text USING stack_id::text;

ALTER TABLE agent_stack
  ADD CONSTRAINT agent_stack_stack_id_fkey
  FOREIGN KEY (stack_id) REFERENCES stack(id);
