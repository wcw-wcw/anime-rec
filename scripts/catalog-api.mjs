import http from "node:http";
import { createMalClient } from "./mal-client.mjs";
import { readCatalog, mergeAnimeCatalog, writeCatalog } from "./catalog-storage.mjs";

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

function extractMalId(value) {
  const match = value.match(/myanimelist\.net\/anime\/(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findExistingAnime(catalog, query) {
  const malId = extractMalId(query);
  if (malId) return catalog.find((anime) => anime.malId === malId);

  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return undefined;

  const exact = catalog.find((anime) => {
    const titles = [anime.title?.english, anime.title?.romaji, anime.title?.native].filter(Boolean).map(normalize);
    return titles.some((title) => title === normalizedQuery);
  });

  if (exact) return exact;

  return catalog.find((anime) => {
    const titles = [anime.title?.english, anime.title?.romaji, anime.title?.native].filter(Boolean).map(normalize);
    return titles.some((title) => {
      if (!title.includes(normalizedQuery)) return false;
      const suffix = title.slice(title.indexOf(normalizedQuery) + normalizedQuery.length).trim();
      return !/^(?:\d+|season|part|2nd|3rd|4th)\b/i.test(suffix);
    });
  });
}

function titleMatchScore(anime, query) {
  const normalizedQuery = normalize(query);
  const titles = [anime.title?.english, anime.title?.romaji, anime.title?.native].filter(Boolean).map(normalize);
  if (titles.some((title) => title === normalizedQuery)) return 100;
  if (titles.some((title) => title.startsWith(normalizedQuery))) return 70;
  if (titles.some((title) => title.includes(normalizedQuery))) return 45;
  const queryTokens = new Set(normalizedQuery.split(" ").filter(Boolean));
  const bestOverlap = Math.max(
    0,
    ...titles.map((title) => {
      const titleTokens = new Set(title.split(" ").filter(Boolean));
      return [...queryTokens].filter((token) => titleTokens.has(token)).length;
    }),
  );
  return bestOverlap;
}

function pickBestSearchResult(results, query) {
  return [...results].sort((left, right) => {
    const titleDelta = titleMatchScore(right, query) - titleMatchScore(left, query);
    if (titleDelta) return titleDelta;
    return (right.score ?? 0) - (left.score ?? 0);
  })[0];
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
      sendJson(response, 200, { anime, catalog: updatedCatalog, stored: true });
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
