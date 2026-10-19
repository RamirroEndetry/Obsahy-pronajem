-- Honza.K má běžnou uživatelskou roli a smí nahrávat obsah stejně jako Pavla a Kuba.
INSERT INTO permissions (user_id, can_upload, updated_at)
VALUES ('honza', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
ON CONFLICT(user_id) DO NOTHING;
