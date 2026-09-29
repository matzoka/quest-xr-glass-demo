-- v27: the data is the user's own sales (one car, one driver), so trips has no vehicle / driver
-- columns. D1 counts every row AND every index entry touched as a row written (free plan:
-- 100,000 / day), so this migration never rewrites the old rows:
--   - no DELETE / UPDATE / ALTER TABLE DROP COLUMN over the old table (26,712 rows x 13 = ~350k
--     rows written); the old table is only RENAMED (metadata only) and left as trips_v26_legacy
--     (about 14 MB of storage; drop it on a day with spare write budget, see README).
--   - the new trips table has ONE secondary index (date), created BEFORE any row is inserted.
-- Rows written by an import of N trips into this table: about 2 x N (+ vocab x 2 + meta x 2).
ALTER TABLE trips RENAME TO trips_v26_legacy;
CREATE TABLE trips (
  id INTEGER PRIMARY KEY,               -- record id (row order = id order)
  date TEXT NOT NULL,                   -- 乗車日 YYYY-MM-DD
  time TEXT NOT NULL,                   -- 乗車時刻 HH:MM
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,               -- 1..12
  day INTEGER NOT NULL,
  weekday TEXT NOT NULL,                -- 日 月 火 水 木 金 土
  day_of_week INTEGER NOT NULL,         -- 0=日 .. 6=土
  hour INTEGER NOT NULL,                -- 0..23 (乗車)
  minute INTEGER NOT NULL,
  minute_of_day INTEGER NOT NULL,       -- hour*60+minute (time-of-day filters, midnight wrap)
  dropoff_date TEXT NOT NULL,
  dropoff_time TEXT NOT NULL,           -- 降車時刻 HH:MM
  dropoff_hour INTEGER NOT NULL,
  dropoff_minute INTEGER NOT NULL,
  dropoff_minute_of_day INTEGER NOT NULL,
  pickup_area TEXT NOT NULL DEFAULT '',
  pickup_town TEXT NOT NULL DEFAULT '',
  pickup_address TEXT NOT NULL DEFAULT '',      -- verbatim
  pickup_address_norm TEXT NOT NULL DEFAULT '', -- NFKC(pickup_address) for keyword search
  dropoff_area TEXT NOT NULL DEFAULT '',
  dropoff_town TEXT NOT NULL DEFAULT '',
  dropoff_address TEXT NOT NULL DEFAULT '',
  dropoff_address_norm TEXT NOT NULL DEFAULT '',
  distance REAL NOT NULL DEFAULT 0,     -- km
  dispatch INTEGER NOT NULL DEFAULT 0,  -- 迎車 1/0
  fare INTEGER NOT NULL DEFAULT 0,      -- 税抜
  tax INTEGER NOT NULL DEFAULT 0,
  fare_with_tax INTEGER NOT NULL DEFAULT 0,
  dispatch_fee INTEGER NOT NULL DEFAULT 0,
  total_fare INTEGER NOT NULL DEFAULT 0, -- 税込 + 迎車料金
  occupied_minutes INTEGER NOT NULL DEFAULT 0,
  empty_minutes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_trips_v27_date ON trips(date); -- the legacy table keeps the old idx_trips_* names
DELETE FROM vocab WHERE kind IN ('vehicle', 'driver');
