-- Rebrand system and plugin user emails from teable.ai to cybernetics.ai
UPDATE "users"
SET "email" = REPLACE("email", '@system.teable.ai', '@system.cybernetics.ai')
WHERE "email" LIKE '%@system.teable.ai';

UPDATE "users"
SET "email" = REPLACE("email", '@plugin.teable.ai', '@plugin.cybernetics.ai')
WHERE "email" LIKE '%@plugin.teable.ai';
