import http from "node:http";
import { createMalClient } from "./mal-client.mjs";
import { readCatalog, mergeAnimeCatalog, writeCatalog } from "./catalog-storage.mjs";
import { extractMalId, findExistingAnime, pickBestSearchResult } from "./catalog-lookup.mjs";
import { databaseConfigured, getSql, getVectorSimilarAnime } from "./neon-db.mjs";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
const client = await createMalClient();
const DEFAULT_VECTOR_LIMIT = 20;
const MAX_VECTOR_LIMIT = 50;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 200, {});
    return;
  }

  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (request.method === "GET" && url.pathname === "/api/catalog") {
      sendJson(response, 200, await readCatalog());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/anime/lookup") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) {
        sendJson(response, 400, { error: "Missing q query parameter" });
        return;
      }

      const catalog = await readCatalog();
      const malId = extractMalId(query);
      const existing = findExistingAnime(catalog, query);

      if (existing) {
        sendJson(response, 200, { anime: existing, catalog, stored: false });
        return;
      }

      const anime = malId ? await client.getById(malId) : pickBestSearchResult(await client.search(query, 10), query);
      if (!anime) {
        sendJson(response, 404, { error: "Anime not found" });
        return;
      }

      const updatedCatalog = mergeAnimeCatalog(catalog, [anime]);
      await writeCatalog(updatedCatalog);
      sendJson(response, 200, { anime, catalog: updatedCatalog, stored: true, persisted: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/vector-similar") {
      const animeId = parseAnimeId(url.searchParams.get("animeId") ?? url.searchParams.get("malId"));
      if (!animeId) {
        sendJson(response, 400, { error: "Missing or invalid animeId query parameter" });
        return;
      }

      if (!databaseConfigured()) {
        sendJson(response, 500, { error: "Database is not configured" });
        return;
      }

      const limit = clampVectorLimit(url.searchParams.get("limit"));
      const embeddingModel = process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
      const result = await getVectorSimilarAnime({ animeId, limit, model: embeddingModel, sql: getSql() });

      if (result.status === "empty") {
        sendJson(response, 404, { error: "No anime embeddings are available for vector similarity yet" });
        return;
      }

      if (result.status === "missing_source_embedding") {
        sendJson(response, 404, { error: "No embedding found for the requested anime", animeId });
        return;
      }

      sendJson(response, 200, {
        source: result.source,
        scoreType: "vector_semantic_similarity",
        limit,
        similar: result.similar,
      });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Unknown server error" });
  }
});

server.listen(port, host, () => {
  console.log(`AnimeRec catalog API listening at http://${host}:${port}`);
});

function parseAnimeId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function clampVectorLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_VECTOR_LIMIT;
  return Math.max(1, Math.min(MAX_VECTOR_LIMIT, parsed));
}
