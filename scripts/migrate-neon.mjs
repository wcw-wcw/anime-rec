import { loadEnv } from "./env.mjs";
import { ensureAnimeTable, getSql } from "./neon-db.mjs";

await loadEnv();
await ensureAnimeTable(getSql());
console.log("Neon anime table is ready.");
