-- Remove server leave count tracking

-- Drop the function
DROP FUNCTION IF EXISTS discord.increment_server_leave_count;

-- Remove the column from user_activity table
ALTER TABLE discord.user_activity DROP COLUMN IF EXISTS server_leave_count;
