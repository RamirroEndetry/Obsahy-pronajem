-- Pronájmy převzaté z NEXu + stav obsahu
CREATE TABLE IF NOT EXISTS rentals (
  id           TEXT PRIMARY KEY,
  reported     TEXT NOT NULL DEFAULT '',
  customer     TEXT NOT NULL DEFAULT '',
  contact      TEXT NOT NULL DEFAULT '',
  event        TEXT NOT NULL DEFAULT '',
  event_date   TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT,
  confirmed_at INTEGER,
  created_by   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Odkazy na obsah (Úschovna, WeTransfer, Drive…)
CREATE TABLE IF NOT EXISTS items (
  id         TEXT PRIMARY KEY,
  rental_id  TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_rental ON items(rental_id);

-- Přihlášení (ukládá se jen otisk tokenu)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Ochrana proti hádání PINu
CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

-- Čítač změn, aby klienti při dotazování stahovali data jen při změně
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL
);
INSERT OR IGNORE INTO meta (k, v) VALUES ('version', 0);
