-- Oprávnění uživatelů, která nastavuje admin (např. smí nahrávat obsah)
CREATE TABLE IF NOT EXISTS permissions (
  user_id    TEXT PRIMARY KEY,
  can_upload INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at INTEGER
);
