-- Detaily pronájmu z rozbaleného řádku v NEXu (panely, odvoz, vzkaz pro technika…) jako JSON
ALTER TABLE rentals ADD COLUMN details TEXT NOT NULL DEFAULT '{}';
