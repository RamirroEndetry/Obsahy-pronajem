-- Klient si nahrává obsah na panely sám
ALTER TABLE rentals ADD COLUMN self_upload INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rentals ADD COLUMN self_by TEXT;
ALTER TABLE rentals ADD COLUMN self_at INTEGER;
