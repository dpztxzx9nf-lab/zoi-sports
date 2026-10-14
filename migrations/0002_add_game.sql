-- Adds nullable game column for per-game tryouts. Apply once: wrangler d1 execute <DB> --remote --file migrations/0002_add_game.sql
ALTER TABLE applications ADD COLUMN game TEXT;
