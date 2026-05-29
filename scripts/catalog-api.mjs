import http from "node:http";
import { createMalClient } from "./mal-client.mjs";
import { readCatalog, mergeAnimeCatalog, writeCatalog } from "./catalog-storage.mjs";
import { extractMalId, findExistingAnime, pickBestSearchResult } from "./catalog-lookup.mjs";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
const client = await createMalClient();

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

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Unknown server error" });
  }
});

server.listen(port, host, () => {
  console.log(`AnimeRec catalog API listening at http://${host}:${port}`);
});
