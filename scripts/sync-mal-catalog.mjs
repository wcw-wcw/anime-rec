import { readCatalog, mergeAnimeCatalog, writeCatalog } from "./catalog-storage.mjs";
import { loadEnv } from "./env.mjs";
import { createMalClient } from "./mal-client.mjs";

await loadEnv();

const rankingTargets = [
  ["all", Number(process.env.MAL_SYNC_ALL_LIMIT ?? 1000)],
  ["airing", Number(process.env.MAL_SYNC_AIRING_LIMIT ?? 500)],
  ["upcoming", Number(process.env.MAL_SYNC_UPCOMING_LIMIT ?? 500)],
  ["tv", Number(process.env.MAL_SYNC_TV_LIMIT ?? 1000)],
  ["movie", Number(process.env.MAL_SYNC_MOVIE_LIMIT ?? 500)],
];
const pageSize = 100;

const client = await createMalClient();
let catalog = await readCatalog();

for (const [rankingType, targetCount] of rankingTargets) {
  console.log(`Fetching MAL ${rankingType} top ${targetCount}...`);
  for (let offset = 0; offset < targetCount; offset += pageSize) {
    const anime = await client.ranking(rankingType, Math.min(pageSize, targetCount - offset), offset);
    catalog = mergeAnimeCatalog(catalog, anime);
    await writeCatalog(catalog);
    console.log(`Stored ${catalog.length} unique anime after ${rankingType} offset ${offset}.`);
    if (anime.length < pageSize) break;
  }
}

console.log(`Done. Catalog saved to src/data/animeCatalog.json with ${catalog.length} anime.`);
