import { loadEnv } from "./env.mjs";
import { readCatalog } from "./catalog-storage.mjs";
import { ensureAnimeTable, getDatabaseCatalog, getSql, upsertAnimeCatalog } from "./neon-db.mjs";

await loadEnv();
const sql = getSql();
const catalog = await readCatalog();

console.log(`Preparing Neon table...`);
await ensureAnimeTable(sql);
console.log(`Uploading ${catalog.length} anime to Neon...`);
await upsertAnimeCatalog(catalog, sql);
const stored = await getDatabaseCatalog(sql);
console.log(`Done. Neon contains ${stored.length} anime.`);
