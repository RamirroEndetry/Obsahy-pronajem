-- Poznámky týmu u pronájmu (píšou všichni přihlášení)
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  rental_id  TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_rental ON notes(rental_id);
