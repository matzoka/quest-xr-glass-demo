-- v26: taxi analytics (D1 database "taxi-analytics", binding DB)
-- trips = output of taxiTripFromRecord() in public/quest-mr/app.js (raw record fields +
-- derived calendar / time / fare fields). Loaded by scripts/import-trips.mjs.
CREATE TABLE IF NOT EXISTS trips (
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
  vehicle TEXT NOT NULL,
  driver TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(date);
CREATE INDEX IF NOT EXISTS idx_trips_weekday_date ON trips(weekday, date);
CREATE INDEX IF NOT EXISTS idx_trips_hour ON trips(hour);
CREATE INDEX IF NOT EXISTS idx_trips_minute_of_day ON trips(minute_of_day);
CREATE INDEX IF NOT EXISTS idx_trips_dropoff_mod ON trips(dropoff_minute_of_day);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips(vehicle);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver);
CREATE INDEX IF NOT EXISTS idx_trips_pickup_area ON trips(pickup_area);
CREATE INDEX IF NOT EXISTS idx_trips_dropoff_area ON trips(dropoff_area);
CREATE INDEX IF NOT EXISTS idx_trips_pickup_town ON trips(pickup_town);
CREATE INDEX IF NOT EXISTS idx_trips_dropoff_town ON trips(dropoff_town);
CREATE INDEX IF NOT EXISTS idx_trips_dispatch ON trips(dispatch);

-- Valid values for validation / suggestions (もしかして…), in display order.
-- kind: vehicle | driver | area | town (parent = area of the town). reading: ひらがな (optional).
CREATE TABLE IF NOT EXISTS vocab (
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  ord INTEGER NOT NULL,
  reading TEXT,
  parent TEXT,
  PRIMARY KEY (kind, value)
);

-- Dataset metadata: note (shown with every result), fareRule, dataset label, importedAt
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
