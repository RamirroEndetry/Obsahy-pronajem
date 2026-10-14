-- Upozornění pro jednotlivé uživatele (např. admin přidal nové pronájmy)
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  rental_ids TEXT NOT NULL DEFAULT '',
  text       TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);
