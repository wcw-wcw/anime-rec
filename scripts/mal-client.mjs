import { setTimeout as delay } from "node:timers/promises";
import { loadEnv } from "./env.mjs";

const baseUrl = "https://api.myanimelist.net/v2";
const requestTimeoutMs = 12000;
const defaultFields = [
  "id",
  "title",
  "main_picture",
  "alternative_titles",
  "synopsis",
  "genres",
  "media_type",
  "num_episodes",
  "mean",
  "rank",
  "popularity",
  "start_season",
  "studios",
].join(",");

let lastRequestAt = 0;

export async function createMalClient() {
  await loadEnv();
  const clientId = process.env.MAL_CLIENT_ID;
  if (!clientId) throw new Error("Missing MAL_CLIENT_ID in .env");

  const perSecond = Number(process.env.MAL_RATE_LIMIT_PER_SECOND ?? 2);
  const spacingMs = Math.ceil(1000 / Math.max(0.25, perSecond));

  async function request(path, params = {}) {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < spacingMs) await delay(spacingMs - elapsed);
    lastRequestAt = Date.now();

    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    let response;
    try {
      response = await fetch(url, {
        headers: { "X-MAL-CLIENT-ID": clientId },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MAL request failed (${response.status}) for ${url.pathname}: ${body.slice(0, 240)}`);
    }

    return response.json();
  }

  return {
    async ranking(rankingType, limit = 100, offset = 0) {
      const body = await request("/anime/ranking", {
        ranking_type: rankingType,
        limit,
        offset,
        fields: defaultFields,
      });

      return (body.data ?? []).map((item) => mapMalNode(item.node, rankingType, item.ranking?.rank));
    },

    async search(query, limit = 10) {
      const body = await request("/anime", {
        q: query,
        limit,
        fields: defaultFields,
      });

      return (body.data ?? []).map((item) => mapMalNode(item.node));
    },

    async getById(id) {
      return mapMalNode(await request(`/anime/${id}`, { fields: defaultFields }));
    },
  };
}

export function mapMalNode(node, rankingType, rankingRank) {
  const mediaType = node.media_type;
  return {
    id: node.id,
    malId: node.id,
    title: {
      english: node.alternative_titles?.en || undefined,
      romaji: node.title,
      native: node.alternative_titles?.ja || undefined,
    },
    imageUrl: node.main_picture?.large ?? node.main_picture?.medium ?? "",
    synopsis: cleanSynopsis(node.synopsis ?? ""),
    genres: node.genres?.map((genre) => genre.name) ?? [],
    themes: [],
    demographics: [],
    studios: node.studios?.map((studio) => studio.name) ?? [],
    year: node.start_season?.year ?? undefined,
    format: mediaType === "movie" ? "Movie" : mediaType === "ova" ? "OVA" : mediaType === "ona" ? "ONA" : mediaType === "special" ? "Special" : "TV",
    episodes: node.num_episodes ?? undefined,
    score: node.mean ?? undefined,
    rank: rankingRank ?? node.rank ?? undefined,
    popularity: node.popularity ?? undefined,
    rankingTypes: rankingType ? [rankingType] : [],
    source: "mal",
  };
}

function cleanSynopsis(synopsis) {
  return synopsis.replace(/\s*\[Written by MAL Rewrite\]\s*$/i, "").trim();
}
