-- Malé textové soubory u pronájmu (např. seznam odkazů od klienta)
CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  rental_id  TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_rental ON files(rental_id);
