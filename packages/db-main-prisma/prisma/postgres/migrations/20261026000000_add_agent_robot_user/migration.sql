-- The admin-only agent's system user (see AGENT_ROBOT_USER in @cybernetics/core)
INSERT INTO "users" ("id", "name", "email", "is_system", "created_time")
SELECT 'agentRobot', 'Agent', 'agentRobot@system.cybernetics.ai', true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = 'agentRobot');
