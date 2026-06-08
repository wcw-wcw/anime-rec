import { databaseConfigured, getSql, getVectorSimilarAnime } from "../scripts/neon-db.mjs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_MODEL = "text-embedding-3-small";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const url = new URL(request.url ?? "/", `https://${request.headers.host ?? "localhost"}`);
    const animeId = parseAnimeId(url.searchParams.get("animeId") ?? url.searchParams.get("malId"));

    if (!animeId) {
      response.status(400).json({ error: "Missing or invalid animeId query parameter" });
      return;
    }

    if (!databaseConfigured()) {
      response.status(500).json({ error: "Database is not configured" });
      return;
    }

    const limit = clampLimit(url.searchParams.get("limit"));
    const embeddingModel = process.env.EMBEDDING_MODEL || DEFAULT_MODEL;
    const result = await getVectorSimilarAnime({
      animeId,
      limit,
      model: embeddingModel,
      sql: getSql(),
    });

    if (result.status === "empty") {
      response.status(404).json({ error: "No anime embeddings are available for vector similarity yet" });
      return;
    }

    if (result.status === "missing_source_embedding") {
      response.status(404).json({ error: "No embedding found for the requested anime", animeId });
      return;
    }

    response.status(200).json({
      source: result.source,
      scoreType: "vector_semantic_similarity",
      limit,
      similar: result.similar,
    });
  } catch {
    response.status(500).json({ error: "Vector similarity lookup failed" });
  }
}

function parseAnimeId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}
