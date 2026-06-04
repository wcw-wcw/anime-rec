import type { Anime } from "../types";

export type CatalogSortMode = "popularity" | "score" | "year" | "title" | "rank";

export interface CatalogFilters {
  query: string;
  genre: string;
  format: string;
  year: string;
  minScore: number;
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const getAnimeDisplayTitle = (anime: Anime) => anime.title.english || anime.title.romaji || anime.title.native || "Untitled anime";

export const getAnimeById = (catalog: Anime[], id: number) => catalog.find((anime) => anime.id === id) ?? null;

export const getAnimeSubtitle = (anime: Anime) => {
  if (anime.title.english && anime.title.english !== anime.title.romaji) return anime.title.english;
  if (anime.title.native && anime.title.native !== anime.title.romaji) return anime.title.native;
  return "";
};

const formatNumber = (value: number | undefined, prefix = "") => (typeof value === "number" ? `${prefix}${value.toLocaleString()}` : "Unknown");

export const formatAnimeMetadata = (anime: Anime) => ({
  format: anime.format || "Unknown",
  year: anime.year ? String(anime.year) : "Unknown",
  episodes: anime.episodes ? `${anime.episodes.toLocaleString()} eps` : "Unknown",
  score: typeof anime.score === "number" ? anime.score.toFixed(2) : "Unknown",
  rank: formatNumber(anime.rank, "#"),
  popularity: formatNumber(anime.popularity, "#"),
  studios: anime.studios?.length ? anime.studios.join(", ") : "Unknown",
});

const uniqueSorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));

export const getUniqueGenres = (catalog: Anime[]) => uniqueSorted(catalog.flatMap((anime) => anime.genres ?? []));

export const getUniqueFormats = (catalog: Anime[]) => uniqueSorted(catalog.map((anime) => anime.format).filter(Boolean));

export const getUniqueYears = (catalog: Anime[]) =>
  [...new Set(catalog.map((anime) => anime.year).filter((year): year is number => typeof year === "number"))].sort((left, right) => right - left);

export const filterAnimeCatalog = (catalog: Anime[], filters: CatalogFilters) => {
  const normalizedQuery = normalize(filters.query.trim());

  return catalog.filter((anime) => {
    const searchableText = normalize([getAnimeDisplayTitle(anime), anime.title.romaji, anime.title.native, anime.synopsis].filter(Boolean).join(" "));
    const score = anime.score ?? 0;

    return (
      (!normalizedQuery || searchableText.includes(normalizedQuery)) &&
      (!filters.genre || (anime.genres ?? []).includes(filters.genre)) &&
      (!filters.format || anime.format === filters.format) &&
      (!filters.year || anime.year === Number(filters.year)) &&
      (!filters.minScore || score >= filters.minScore)
    );
  });
};

const missingNumber = Number.POSITIVE_INFINITY;

export const sortAnimeCatalog = (catalog: Anime[], sortMode: CatalogSortMode) => {
  const sorted = [...catalog];

  sorted.sort((left, right) => {
    switch (sortMode) {
      case "score":
        return (right.score ?? -1) - (left.score ?? -1) || getAnimeDisplayTitle(left).localeCompare(getAnimeDisplayTitle(right));
      case "year":
        return (right.year ?? -1) - (left.year ?? -1) || getAnimeDisplayTitle(left).localeCompare(getAnimeDisplayTitle(right));
      case "title":
        return getAnimeDisplayTitle(left).localeCompare(getAnimeDisplayTitle(right));
      case "rank":
        return (left.rank ?? missingNumber) - (right.rank ?? missingNumber) || getAnimeDisplayTitle(left).localeCompare(getAnimeDisplayTitle(right));
      case "popularity":
      default:
        return (
          (left.popularity ?? missingNumber) - (right.popularity ?? missingNumber) ||
          (left.rank ?? missingNumber) - (right.rank ?? missingNumber) ||
          getAnimeDisplayTitle(left).localeCompare(getAnimeDisplayTitle(right))
        );
    }
  });

  return sorted;
};
