-- Per-match stats bag and a first-class damage column for charts.
ALTER TABLE lab_cod_matches ADD COLUMN damage INTEGER;
ALTER TABLE lab_cod_matches ADD COLUMN stats TEXT;
