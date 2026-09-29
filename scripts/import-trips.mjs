#!/usr/bin/env node
// v26: load taxi trips into the D1 database "taxi-analytics" (binding DB).
// v27: one car / one driver (no vehicle / driver), write-budget guard, skip when unchanged, --local.
//
//   node scripts/import-trips.mjs --sample [--apply | --local]  # the app's own sample trips
//   node scripts/import-trips.mjs --input records.json [--vocab vocab.json] [--note "..."] [--dataset "..."] [--apply | --local]
//
// D1 free plan: 100,000 rows written per day (resets 00:00 UTC = 09:00 JST). Every inserted or
// deleted trip costs 1 row + 1 per index on trips (schema 0002: only idx_trips_date -> 2 rows).
// Before --apply the script READS the remote DB (trip count, index count, content hash) and
//   - skips the import when the data is unchanged (same contentHash in meta; --force to override),
//   - refuses when the estimated rows written exceed --max-writes (default 50000).
// Estimate = old trips x (1 + indexes) [DELETE] + new trips x (1 + indexes) [INSERT] + vocab/meta.
// Do not run repeated test imports against --remote; test with --local (wrangler dev state).
//
// records.json: JSON array of RAW records, the same shape the app normalises with
// taxiTripFromRecord() (public/quest-mr/app.js):
//   { id, date "YYYY-MM-DD", time "HH:MM", pickupArea, pickupTown, pickupAddress,
//     dropoffArea, dropoffTown, dropoffAddress, distance (km), dispatch (bool), occupiedMinutes,
//     emptyMinutes, [fare (税抜)], [dropoffTime "HH:MM"], [dropoffDate] }
// Every record goes through the app's taxiTripFromRecord(), so derived fields (weekday, hour,
// dropoff time, 税込, 迎車料金, 収入 …) are computed exactly as in the app.
// vocab.json (optional): [{ kind: "area"|"town", value, reading?, parent? }, …]
//   in display order. Without it the vocab is derived from the records (first appearance order).
// Output: an SQL file (default /tmp/taxi-import.sql) that REPLACES trips / vocab / meta.
// --apply runs: wrangler d1 execute taxi-analytics --remote --file <out> -y
// (needs CLOUDFLARE_API_TOKEN with D1 Edit and CLOUDFLARE_ACCOUNT_ID in the environment).
// --local runs the same against the local wrangler D1 state (.wrangler/, used by wrangler dev).
// Schema: migrations/ (wrangler d1 migrations apply taxi-analytics --remote | --local).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_NAME = "taxi-analytics";
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = name => argv.includes(name);
if (!has("--sample") && !opt("--input")) {
  console.error("usage: node scripts/import-trips.mjs (--sample | --input records.json [--vocab vocab.json]) [--out file.sql] [--note text] [--dataset label] [--apply | --local] [--max-writes N] [--force]");
  process.exit(2);
}

// Load the app's generator + normaliser (single source of truth) into a sandbox
export function loadAppDataCode(appPath = path.join(ROOT, "public/quest-mr/app.js")) {
  const src = fs.readFileSync(appPath, "utf8");
  const fnText = name => {
    const i = src.indexOf(`function ${name}(`);
    if (i < 0) throw new Error(`${name} not found in app.js`);
    let d = 0;
    for (let k = src.indexOf("{", i); k < src.length; k++) {
      if (src[k] === "{") d++;
      else if (src[k] === "}" && --d === 0) return src.slice(i, k + 1);
    }
    throw new Error(`unbalanced ${name}`);
  };
  const a = src.indexOf("const TAXI_DATASET_SEED");
  const b = src.indexOf("const taxiTrips = generateTaxiDataset();");
  const r0 = src.indexOf("const TAXI_READINGS = {");
  const r1 = src.indexOf("};", r0) + 2;
  if (a < 0 || b < 0 || r0 < 0) throw new Error("app.js layout changed: generator / TAXI_READINGS not found");
  const code = src.slice(a, b) + "\n" + src.slice(r0, r1) + "\n" + fnText("taxiLocalDateString") +
    "\n;globalThis.__d = { generateTaxiDataset, taxiTripFromRecord, TAXI_AREAS, TAXI_AREA_TOWNS, TAXI_READINGS, TAXI_FARE_PER_KM, TAXI_TAX_RATE, TAXI_DISPATCH_FEE, TAXI_DATASET_END_DATE: typeof TAXI_DATASET_END_DATE === 'string' ? TAXI_DATASET_END_DATE : null };";
  const ctx = { Math, Date, String, Number, Object, Array, JSON, Set, Map };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: "app-data-slice.js" });
  return ctx.__d;
}

const q = v => (v === null || v === undefined ? "NULL" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NULL") : `'${String(v).replace(/'/g, "''")}'`);
const hm = s => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };

export function buildImport({ sample, records, vocabRows, note, dataset }) {
  const D = loadAppDataCode();
  let trips, vocab;
  if (sample) {
    trips = D.generateTaxiDataset();
    vocab = [];
    D.TAXI_AREAS.forEach(v => vocab.push({ kind: "area", value: v, reading: D.TAXI_READINGS[v] || null }));
    D.TAXI_AREAS.forEach(a => (D.TAXI_AREA_TOWNS[a] || []).forEach(([t, r]) => vocab.push({ kind: "town", value: t, reading: r, parent: a })));
  } else {
    trips = records.map(r => D.taxiTripFromRecord(r));
    if (vocabRows) vocab = vocabRows;
    else {
      vocab = [];
      const seen = new Set();
      const add = (kind, value, parent) => { if (!value) return; const k = kind + "\u0000" + value; if (seen.has(k)) return; seen.add(k); vocab.push({ kind, value, parent: parent || null }); };
      trips.forEach(t => { add("area", t.pickupArea); add("area", t.dropoffArea); });
      trips.forEach(t => { add("town", t.pickupTown, t.pickupArea); add("town", t.dropoffTown, t.dropoffArea); });
    }
  }
  // sanity checks
  const ids = new Set();
  for (const t of trips) {
    if (t.id === undefined || t.id === null || ids.has(t.id)) throw new Error(`missing / duplicate id: ${t.id}`);
    ids.add(t.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !/^\d{2}:\d{2}$/.test(t.time)) throw new Error(`bad date/time in record ${t.id}`);
  }
  trips.sort((a, b) => a.id - b.id);
  const cols = ["id", "date", "time", "year", "month", "day", "weekday", "day_of_week", "hour", "minute", "minute_of_day", "dropoff_date", "dropoff_time", "dropoff_hour", "dropoff_minute", "dropoff_minute_of_day", "pickup_area", "pickup_town", "pickup_address", "pickup_address_norm", "dropoff_area", "dropoff_town", "dropoff_address", "dropoff_address_norm", "distance", "dispatch", "fare", "tax", "fare_with_tax", "dispatch_fee", "total_fare", "occupied_minutes", "empty_minutes"];
  const row = t => [t.id, t.date, t.time, t.year, t.month, t.day, t.weekday, t.dayOfWeek, t.hour, t.minute, t.hour * 60 + t.minute, t.dropoffDate, t.dropoffTime, t.dropoffHour, t.dropoffMinute, hm(t.dropoffTime), t.pickupArea, t.pickupTown, t.pickupAddress, String(t.pickupAddress).normalize("NFKC"), t.dropoffArea, t.dropoffTown, t.dropoffAddress, String(t.dropoffAddress).normalize("NFKC"), t.distance, t.dispatch ? 1 : 0, t.fare, t.tax, t.fareWithTax, t.dispatchFee, t.totalFare, t.occupiedMinutes, t.emptyMinutes];
  // content hash (trips + vocab, not importedAt): an unchanged dataset is never re-imported
  const tripRows = trips.map(row);
  const contentHash = crypto.createHash("sha256").update(JSON.stringify({ cols, tripRows, vocab })).digest("hex").slice(0, 32);
  const out = ["DELETE FROM trips;", "DELETE FROM vocab;", "DELETE FROM meta;"];
  for (let i = 0; i < tripRows.length; i += 100) {
    out.push(`INSERT INTO trips (${cols.join(",")}) VALUES\n${tripRows.slice(i, i + 100).map(r => `(${r.map(q).join(",")})`).join(",\n")};`);
  }
  vocab.forEach((v, i) => out.push(`INSERT INTO vocab (kind,value,ord,reading,parent) VALUES (${q(v.kind)},${q(v.value)},${i},${q(v.reading ?? null)},${q(v.parent ?? null)});`));
  const meta = {
    note: note || (sample ? "サンプル（合成）データによる集計結果" : "実データによる集計結果"),
    dataset: dataset || (sample ? `sample seed=42 end=${D.TAXI_DATASET_END_DATE}` : "imported"),
    fareRule: `税抜=距離×${D.TAXI_FARE_PER_KM}円, 税込=税抜+消費税${D.TAXI_TAX_RATE * 100}%, 収入=税込+迎車料金${D.TAXI_DISPATCH_FEE}円(迎車時のみ・非課税)`,
    importedAt: new Date().toISOString(),
    tripCount: String(trips.length),
    contentHash,
  };
  Object.entries(meta).forEach(([k, v]) => out.push(`INSERT INTO meta (key,value) VALUES (${q(k)},${q(v)});`));
  return { sql: out.join("\n") + "\n", trips, vocab, meta, contentHash };
}

// rows written by the replace-all import (D1 counts table rows + index entries)
export function estimateRowsWritten({ oldTrips, oldVocab = 0, oldMeta = 0, tripIndexes, newTrips, newVocab, newMeta }) {
  const perTrip = 1 + tripIndexes;
  return oldTrips * perTrip + newTrips * perTrip + (oldVocab + newVocab) * 2 + (oldMeta + newMeta) * 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sample = has("--sample");
  const records = sample ? null : JSON.parse(fs.readFileSync(opt("--input"), "utf8"));
  const vocabRows = opt("--vocab") ? JSON.parse(fs.readFileSync(opt("--vocab"), "utf8")) : null;
  const { sql, trips, vocab, meta, contentHash } = buildImport({ sample, records, vocabRows, note: opt("--note"), dataset: opt("--dataset") });
  const outFile = opt("--out") || "/tmp/taxi-import.sql";
  fs.writeFileSync(outFile, sql);
  console.log(`trips: ${trips.length} (${trips[0]?.date} .. ${trips[trips.length - 1]?.date}), vocab: ${vocab.length}, contentHash: ${contentHash}, sql: ${outFile} (${(sql.length / 1e6).toFixed(1)} MB)`);
  const target = has("--apply") ? "--remote" : has("--local") ? "--local" : null;
  if (target) {
    const wrangler = path.join(ROOT, "node_modules/wrangler/bin/wrangler.js");
    const d1 = (...args) => execFileSync(process.execPath, [wrangler, "d1", "execute", DB_NAME, target, ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    const readJson = command => JSON.parse(d1("--json", "--command", command))[0].results[0];
    // 1) read-only pre-check
    const cur = readJson("SELECT (SELECT COUNT(*) FROM trips) AS trips, (SELECT COUNT(*) FROM vocab) AS vocab, (SELECT COUNT(*) FROM meta) AS meta, " +
      "(SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND tbl_name = 'trips') AS idx, (SELECT value FROM meta WHERE key = 'contentHash') AS hash, " +
      "(SELECT COUNT(*) FROM pragma_table_info('trips') WHERE name = 'vehicle') AS legacy");
    console.log(`${target} now: ${JSON.stringify(cur)}`);
    if (Number(cur.legacy)) {
      console.error(`trips still has the v26 vehicle column: apply migrations first (wrangler d1 migrations apply ${DB_NAME} ${target}).`);
      process.exit(3);
    }
    const est = estimateRowsWritten({ oldTrips: Number(cur.trips), oldVocab: Number(cur.vocab), oldMeta: Number(cur.meta), tripIndexes: Number(cur.idx), newTrips: trips.length, newVocab: vocab.length, newMeta: Object.keys(meta).length });
    const maxWrites = Number(opt("--max-writes") || 50000);
    console.log(`estimated rows written: ${est.toLocaleString()} (limit for this run: ${maxWrites.toLocaleString()}; D1 free plan: 100,000 / day)`);
    if (cur.hash === contentHash && !has("--force")) {
      console.log("unchanged (same contentHash): nothing written.");
      process.exit(0);
    }
    if (est > maxWrites && !has("--force")) {
      console.error("refusing: estimated rows written exceed --max-writes (use --max-writes N or --force deliberately).");
      process.exit(4);
    }
    // 2) the import itself
    const res = d1("--file", outFile, "-y", "--json");
    try {
      const parsed = JSON.parse(res);
      const written = (Array.isArray(parsed) ? parsed : [parsed]).reduce((s, r) => s + (Number(r?.meta?.rows_written) || 0), 0);
      if (written) console.log(`rows written (reported): ${written.toLocaleString()}`);
    } catch (e) { /* non-JSON output: ignore */ }
    // 3) read-only check
    console.log(`${target} check: ${JSON.stringify(readJson("SELECT COUNT(*) AS n, MIN(date) AS dfrom, MAX(date) AS dto, (SELECT value FROM meta WHERE key = 'contentHash') AS hash FROM trips"))}`);
  }
}
