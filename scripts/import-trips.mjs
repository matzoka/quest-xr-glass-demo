#!/usr/bin/env node
// v26: load taxi trips into the D1 database "taxi-analytics" (binding DB).
//
//   node scripts/import-trips.mjs --sample [--apply]            # the app's own 26,712 sample trips
//   node scripts/import-trips.mjs --input records.json [--vocab vocab.json] [--note "..."] [--dataset "..."] [--apply]
//
// records.json: JSON array of RAW records, the same shape the app normalises with
// taxiTripFromRecord() (public/quest-mr/app.js):
//   { id, date "YYYY-MM-DD", time "HH:MM", vehicle, driver, pickupArea, pickupTown, pickupAddress,
//     dropoffArea, dropoffTown, dropoffAddress, distance (km), dispatch (bool), occupiedMinutes,
//     emptyMinutes, [fare (税抜)], [dropoffTime "HH:MM"], [dropoffDate] }
// Every record goes through the app's taxiTripFromRecord(), so derived fields (weekday, hour,
// dropoff time, 税込, 迎車料金, 収入 …) are computed exactly as in the app.
// vocab.json (optional): [{ kind: "vehicle"|"driver"|"area"|"town", value, reading?, parent? }, …]
//   in display order. Without it the vocab is derived from the records (first appearance order).
// Output: an SQL file (default /tmp/taxi-import.sql) that REPLACES trips / vocab / meta.
// --apply runs: wrangler d1 execute taxi-analytics --remote --file <out> -y
// (needs CLOUDFLARE_API_TOKEN with D1 Edit and CLOUDFLARE_ACCOUNT_ID in the environment).
// Schema: migrations/0001_taxi_schema.sql (wrangler d1 migrations apply taxi-analytics --remote).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_NAME = "taxi-analytics";
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = name => argv.includes(name);
if (!has("--sample") && !opt("--input")) {
  console.error("usage: node scripts/import-trips.mjs (--sample | --input records.json [--vocab vocab.json]) [--out file.sql] [--note text] [--dataset label] [--apply]");
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
    "\n;globalThis.__d = { generateTaxiDataset, taxiTripFromRecord, TAXI_VEHICLES, TAXI_DRIVERS, TAXI_AREAS, TAXI_AREA_TOWNS, TAXI_READINGS, TAXI_FARE_PER_KM, TAXI_TAX_RATE, TAXI_DISPATCH_FEE, TAXI_DATASET_END_DATE: typeof TAXI_DATASET_END_DATE === 'string' ? TAXI_DATASET_END_DATE : null };";
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
    D.TAXI_VEHICLES.forEach(v => vocab.push({ kind: "vehicle", value: v }));
    D.TAXI_DRIVERS.forEach(v => vocab.push({ kind: "driver", value: v, reading: D.TAXI_READINGS[v] || null }));
    D.TAXI_AREAS.forEach(v => vocab.push({ kind: "area", value: v, reading: D.TAXI_READINGS[v] || null }));
    D.TAXI_AREAS.forEach(a => (D.TAXI_AREA_TOWNS[a] || []).forEach(([t, r]) => vocab.push({ kind: "town", value: t, reading: r, parent: a })));
  } else {
    trips = records.map(r => D.taxiTripFromRecord(r));
    if (vocabRows) vocab = vocabRows;
    else {
      vocab = [];
      const seen = new Set();
      const add = (kind, value, parent) => { if (!value) return; const k = kind + "\u0000" + value; if (seen.has(k)) return; seen.add(k); vocab.push({ kind, value, parent: parent || null }); };
      trips.forEach(t => add("vehicle", t.vehicle));
      trips.forEach(t => add("driver", t.driver));
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
  const cols = ["id", "date", "time", "year", "month", "day", "weekday", "day_of_week", "hour", "minute", "minute_of_day", "dropoff_date", "dropoff_time", "dropoff_hour", "dropoff_minute", "dropoff_minute_of_day", "vehicle", "driver", "pickup_area", "pickup_town", "pickup_address", "pickup_address_norm", "dropoff_area", "dropoff_town", "dropoff_address", "dropoff_address_norm", "distance", "dispatch", "fare", "tax", "fare_with_tax", "dispatch_fee", "total_fare", "occupied_minutes", "empty_minutes"];
  const row = t => [t.id, t.date, t.time, t.year, t.month, t.day, t.weekday, t.dayOfWeek, t.hour, t.minute, t.hour * 60 + t.minute, t.dropoffDate, t.dropoffTime, t.dropoffHour, t.dropoffMinute, hm(t.dropoffTime), t.vehicle, t.driver, t.pickupArea, t.pickupTown, t.pickupAddress, String(t.pickupAddress).normalize("NFKC"), t.dropoffArea, t.dropoffTown, t.dropoffAddress, String(t.dropoffAddress).normalize("NFKC"), t.distance, t.dispatch ? 1 : 0, t.fare, t.tax, t.fareWithTax, t.dispatchFee, t.totalFare, t.occupiedMinutes, t.emptyMinutes];
  const out = ["DELETE FROM trips;", "DELETE FROM vocab;", "DELETE FROM meta;"];
  for (let i = 0; i < trips.length; i += 100) {
    out.push(`INSERT INTO trips (${cols.join(",")}) VALUES\n${trips.slice(i, i + 100).map(t => `(${row(t).map(q).join(",")})`).join(",\n")};`);
  }
  vocab.forEach((v, i) => out.push(`INSERT INTO vocab (kind,value,ord,reading,parent) VALUES (${q(v.kind)},${q(v.value)},${i},${q(v.reading ?? null)},${q(v.parent ?? null)});`));
  const meta = {
    note: note || (sample ? "サンプル（合成）データによる集計結果" : "実データによる集計結果"),
    dataset: dataset || (sample ? `sample seed=42 end=${D.TAXI_DATASET_END_DATE}` : "imported"),
    fareRule: `税抜=距離×${D.TAXI_FARE_PER_KM}円, 税込=税抜+消費税${D.TAXI_TAX_RATE * 100}%, 収入=税込+迎車料金${D.TAXI_DISPATCH_FEE}円(迎車時のみ・非課税)`,
    importedAt: new Date().toISOString(),
    tripCount: String(trips.length),
  };
  Object.entries(meta).forEach(([k, v]) => out.push(`INSERT INTO meta (key,value) VALUES (${q(k)},${q(v)});`));
  return { sql: out.join("\n") + "\n", trips, vocab, meta };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sample = has("--sample");
  const records = sample ? null : JSON.parse(fs.readFileSync(opt("--input"), "utf8"));
  const vocabRows = opt("--vocab") ? JSON.parse(fs.readFileSync(opt("--vocab"), "utf8")) : null;
  const { sql, trips, vocab } = buildImport({ sample, records, vocabRows, note: opt("--note"), dataset: opt("--dataset") });
  const outFile = opt("--out") || "/tmp/taxi-import.sql";
  fs.writeFileSync(outFile, sql);
  console.log(`trips: ${trips.length} (${trips[0]?.date} .. ${trips[trips.length - 1]?.date}), vocab: ${vocab.length}, sql: ${outFile} (${(sql.length / 1e6).toFixed(1)} MB)`);
  if (has("--apply")) {
    const wrangler = path.join(ROOT, "node_modules/wrangler/bin/wrangler.js");
    execFileSync(process.execPath, [wrangler, "d1", "execute", DB_NAME, "--remote", "--file", outFile, "-y"], { cwd: ROOT, stdio: "inherit" });
    const res = execFileSync(process.execPath, [wrangler, "d1", "execute", DB_NAME, "--remote", "--json", "--command", "SELECT COUNT(*) AS n, MIN(date) AS dfrom, MAX(date) AS dto FROM trips"], { cwd: ROOT, encoding: "utf8" });
    console.log("remote check:", JSON.stringify(JSON.parse(res)[0].results[0]));
  }
}
