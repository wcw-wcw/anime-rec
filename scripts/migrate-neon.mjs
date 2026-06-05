import { loadEnv } from "./env.mjs";
import { ensureAnimeEmbeddingSchema, ensureAnimeTable, getSql } from "./neon-db.mjs";

await loadEnv();
const sql = getSql();
await ensureAnimeTable(sql);
await ensureAnimeEmbeddingSchema(sql);
console.log("Neon anime and embedding tables are ready.");
