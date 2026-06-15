-- FNEBooks v1.2.2 session table fix.
-- Run this if admin login fails with: relation "session_pkey" already exists.
-- It creates FNEBooks' dedicated session table using non-conflicting constraint names.

CREATE TABLE IF NOT EXISTS user_sessions (
  sid varchar NOT NULL,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL,
  CONSTRAINT user_sessions_pkey PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions (expire);
