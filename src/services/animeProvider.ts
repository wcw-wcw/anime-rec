import type { Anime } from "../types";
import { localCatalog } from "../data/catalog";
import { extractMalId, findAnime } from "../utils/recommendation";

interface JikanNamedResource {
  name: string;
}

interface JikanAnime {
  mal_id: number;
  title?: string | null;
  title_english?: string | null;
  title_japanese?: string | null;
  images?: {
    jpg?: {
      image_url?: string | null;
      large_image_url?: string | null;
    };
  };
  synopsis?: string | null;
  genres?: JikanNamedResource[];
  themes?: JikanNamedResource[];
  demographics?: JikanNamedResource[];
  studios?: JikanNamedResource[];
  year?: number | null;
  type?: string | null;
  episodes?: number | null;
  score?: number | null;
  rank?: number | null;
  popularity?: number | null;
}

export interface AnimeProvider {
  name: string;
  search(query: string): Promise<Anime[]>;
  getByUrl(url: string): Promise<Anime | null>;
  getCatalog(): Promise<Anime[]>;
}

const mapJikanAnime = (item: JikanAnime): Anime => ({
  id: item.mal_id,
  malId: item.mal_id,
  title: {
    english: item.title_english ?? undefined,
    romaji: item.title ?? item.title_japanese ?? "Untitled",
    native: item.title_japanese ?? undefined,
  },
  imageUrl: item.images?.jpg?.large_image_url ?? item.images?.jpg?.image_url ?? "",
  synopsis: item.synopsis ?? "",
  genres: item.genres?.map((genre) => genre.name) ?? [],
  themes: item.themes?.map((theme) => theme.name) ?? [],
  demographics: item.demographics?.map((demo) => demo.name) ?? [],
  studios: item.studios?.map((studio) => studio.name) ?? [],
  year: item.year ?? undefined,
  format: item.type === "Movie" ? "Movie" : item.type === "OVA" ? "OVA" : item.type === "ONA" ? "ONA" : item.type === "Special" ? "Special" : "TV",
  episodes: item.episodes ?? undefined,
  score: item.score ?? undefined,
  rank: item.rank ?? undefined,
  popularity: item.popularity ?? undefined,
  source: "jikan",
});

const fetchJson = async <T,>(url: string, timeoutMs = 10000): Promise<T> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json() as Promise<T>;
  } finally {
    window.clearTimeout(timeout);
  }
};

export class LocalCatalogProvider implements AnimeProvider {
  name = "Local catalog";

  constructor(private catalog: Anime[] = localCatalog) {}

  setCatalog(catalog: Anime[]) {
    this.catalog = catalog;
  }

  async search(query: string) {
    return findAnime(query, this.catalog).map((match) => match.anime);
  }

  async getByUrl(url: string) {
    const id = extractMalId(url);
    return this.catalog.find((anime) => anime.malId === id) ?? null;
  }

  async getCatalog() {
    return this.catalog;
  }
}

export class JikanProvider implements AnimeProvider {
  name = "Jikan";

  async search(query: string) {
    const body = await fetchJson<{ data?: JikanAnime[] }>(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=10&sfw=true`);
    return (body.data ?? []).map(mapJikanAnime);
  }

  async getByUrl(url: string) {
    const id = extractMalId(url);
    if (!id) return null;
    const body = await fetchJson<{ data?: JikanAnime }>(`https://api.jikan.moe/v4/anime/${id}/full`);
    return body.data ? mapJikanAnime(body.data) : null;
  }

  async getCatalog() {
    return localCatalog;
  }
}

export class CatalogApiProvider implements AnimeProvider {
  name = "Local API + MAL";

  constructor(private baseUrl = import.meta.env.VITE_ANIMEREC_API_URL || (import.meta.env.DEV ? "http://127.0.0.1:8787" : "")) {}

  async search(query: string) {
    const result = await this.lookup(query);
    return result?.anime ? [result.anime] : [];
  }

  async getByUrl(url: string) {
    return (await this.lookup(url))?.anime ?? null;
  }

  async getCatalog() {
    return fetchJson<Anime[]>(`${this.baseUrl}/api/catalog`, 3500);
  }

  async lookup(query: string): Promise<{ anime: Anime; catalog: Anime[]; stored: boolean; persisted?: boolean } | null> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(`${this.baseUrl}/api/anime/lookup?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Catalog API lookup failed");
      return response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
