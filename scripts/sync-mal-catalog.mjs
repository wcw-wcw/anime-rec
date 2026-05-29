import { readCatalog, mergeAnimeCatalog, writeCatalog } from "./catalog-storage.mjs";
import { createMalClient } from "./mal-client.mjs";

const rankingTypes = ["all", "airing", "upcoming", "tv", "movie"];
const limit = 100;

const client = await createMalClient();
let catalog = await readCatalog();

for (const rankingType of rankingTypes) {
  console.log(`Fetching MAL ${rankingType} top ${limit}...`);
  const anime = await client.ranking(rankingType, limit);
  catalog = mergeAnimeCatalog(catalog, anime);
  await writeCatalog(catalog);
  console.log(`Stored ${catalog.length} unique anime after ${rankingType}.`);
}

console.log(`Done. Catalog saved to src/data/animeCatalog.json with ${catalog.length} anime.`);
