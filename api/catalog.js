import { readCatalog } from "../scripts/catalog-storage.mjs";
import { databaseConfigured, ensureAnimeTable, getDatabaseCatalog, getSql } from "../scripts/neon-db.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (databaseConfigured()) {
      const sql = getSql();
      await ensureAnimeTable(sql);
      const catalog = await getDatabaseCatalog(sql);
      if (catalog.length) {
        response.status(200).json(catalog);
        return;
      }
    }
    response.status(200).json(await readCatalog());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Catalog lookup failed" });
  }
}
