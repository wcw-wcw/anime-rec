import { createMalClient } from "../../scripts/mal-client.mjs";
import { readCatalog } from "../../scripts/catalog-storage.mjs";
import { extractMalId, findExistingAnime, pickBestSearchResult } from "../../scripts/catalog-lookup.mjs";
import { databaseConfigured, ensureAnimeTable, getDatabaseCatalog, getSql, upsertAnimeCatalog } from "../../scripts/neon-db.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const url = new URL(request.url ?? "/", `https://${request.headers.host ?? "localhost"}`);
    const query = url.searchParams.get("q")?.trim();

    if (!query) {
      response.status(400).json({ error: "Missing q query parameter" });
      return;
    }

    const sql = databaseConfigured() ? getSql() : null;
    if (sql) await ensureAnimeTable(sql);
    const databaseCatalog = sql ? await getDatabaseCatalog(sql) : [];
    const catalog = databaseCatalog.length ? databaseCatalog : await readCatalog();
    const existing = findExistingAnime(catalog, query);
    if (existing) {
      if (sql) await upsertAnimeCatalog([existing], sql);
      response.status(200).json({ anime: existing, catalog, stored: false, persisted: Boolean(sql) });
      return;
    }

    const client = await createMalClient();
    const malId = extractMalId(query);
    const anime = malId ? await client.getById(malId) : pickBestSearchResult(await client.search(query, 10), query);

    if (!anime) {
      response.status(404).json({ error: "Anime not found" });
      return;
    }

    if (sql) {
      await upsertAnimeCatalog([anime], sql);
      const updatedCatalog = await getDatabaseCatalog(sql);
      response.status(200).json({
        anime,
        catalog: updatedCatalog,
        stored: true,
        persisted: true,
      });
      return;
    }

    response.status(200).json({
      anime,
      catalog: [anime, ...catalog],
      stored: true,
      persisted: false,
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Anime lookup failed" });
  }
}
