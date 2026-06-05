import type {
  Anime,
  Recommendation,
  RecommendationExplanation,
  RecommendationFactor,
  RecommendationFilters,
  RecommendationSortMode,
  SearchMatch,
  SimilarityBreakdown,
} from "../types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "his",
  "her",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "them",
  "through",
  "to",
  "while",
  "with",
]);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value: string) =>
  normalize(value)
    .split(" ")
    .map((token) => token.replace(/(?:ing|edly|edly|ed|ly|s)$/i, ""))
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

const setSimilarity = (left: string[], right: string[]) => {
  const a = new Set(left.map(normalize));
  const b = new Set(right.map(normalize));
  if (!a.size && !b.size) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
};

const textSimilarity = (left: string, right: string) => setSimilarity(tokenize(left), tokenize(right));

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

const sharedValues = (left: string[] | undefined, right: string[] | undefined) => {
  const targetValues = new Set((left ?? []).map(normalize));
  const matches: string[] = [];

  for (const value of right ?? []) {
    if (value && targetValues.has(normalize(value)) && !matches.some((match) => normalize(match) === normalize(value))) {
      matches.push(value);
    }
  }

  return matches;
};

type Vector = Map<string, number>;

const buildIdf = (catalog: Anime[]) => {
  const documentCounts = new Map<string, number>();
  const documents = catalog.map((anime) => new Set(tokenize(anime.synopsis ?? "")));

  for (const document of documents) {
    for (const token of document) {
      documentCounts.set(token, (documentCounts.get(token) ?? 0) + 1);
    }
  }

  const total = Math.max(documents.length, 1);
  const idf = new Map<string, number>();
  for (const [token, count] of documentCounts) {
    idf.set(token, Math.log((1 + total) / (1 + count)) + 1);
  }
  return idf;
};

const vectorizeText = (value: string, idf: Map<string, number>) => {
  const tokens = tokenize(value);
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  const vector: Vector = new Map();
  const length = Math.max(tokens.length, 1);
  for (const [token, count] of counts) {
    vector.set(token, (count / length) * (idf.get(token) ?? 1));
  }

  return vector;
};

const cosineSimilarity = (left: Vector, right: Vector) => {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const value of left.values()) leftMagnitude += value * value;
  for (const value of right.values()) rightMagnitude += value * value;

  const [smaller, larger] = left.size < right.size ? [left, right] : [right, left];
  for (const [token, value] of smaller) {
    dot += value * (larger.get(token) ?? 0);
  }

  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};

const titleText = (anime: Anime) => [anime.title.english, anime.title.romaji, anime.title.native].filter(Boolean).join(" ");

const titleForKey = (anime: Anime) => anime.title.english || anime.title.romaji || anime.title.native || "";

const FRANCHISE_NOISE = new Set([
  "2nd",
  "3rd",
  "4th",
  "arc",
  "cour",
  "final",
  "movie",
  "ona",
  "ova",
  "part",
  "season",
  "shippuden",
  "special",
  "the",
]);

export const franchiseKey = (anime: Anime) => {
  const baseTitle = titleForKey(anime)
    .replace(/\([^)]*\)/g, " ")
    .split(/[:–—-]/)[0];
  const tokens = tokenize(baseTitle)
    .map((token) => token.replace(/^(season|part)\d+$/i, ""))
    .filter((token) => token && !FRANCHISE_NOISE.has(token) && !/^\d+$/.test(token) && !/^[ivxlcdm]+$/i.test(token));

  return tokens.slice(0, Math.min(tokens.length, 2)).join(" ") || normalize(titleForKey(anime));
};

const isLikelyContinuation = (anime: Anime) => {
  const title = normalize(titleText(anime));
  const synopsis = normalize(anime.synopsis ?? "");
  return (
    /\b(?:season|part)\s*\d+\b/.test(title) ||
    /\b\d+(?:nd|rd|th)\s+season\b/.test(title) ||
    /\b(?:2nd|3rd|4th|5th|ii|iii|iv|v)\b/.test(title) ||
    /\bshippuden\b/.test(title) ||
    /\b(?:second|third|fourth|fifth)\s+season\b/.test(synopsis)
  );
};

const closeness = (left: number | undefined, right: number | undefined, range: number) => {
  if (typeof left !== "number" || typeof right !== "number" || range <= 0) return 0;
  return clamp01(1 - Math.abs(left - right) / range);
};

const inverseRankCloseness = (left: number | undefined, right: number | undefined, range: number) => {
  if (typeof left !== "number" || typeof right !== "number" || range <= 0) return 0;
  return clamp01(1 - Math.abs(left - right) / range);
};

const metadataSimilarity = (left: Anime, right: Anime) => {
  let score = 0;
  if (left.format === right.format) score += 0.35;
  if (left.year && right.year) score += Math.max(0, 0.25 - Math.abs(left.year - right.year) / 40);
  if (setSimilarity(left.studios ?? [], right.studios ?? []) > 0) score += 0.25;
  if (setSimilarity(left.demographics ?? [], right.demographics ?? []) > 0) score += 0.15;
  return Math.min(score, 1);
};

const buildBreakdown = (target: Anime, candidate: Anime, storySimilarity: number): SimilarityBreakdown => ({
  genres: setSimilarity(target.genres ?? [], candidate.genres ?? []),
  themes: setSimilarity([...(target.themes ?? []), ...(target.demographics ?? [])], [...(candidate.themes ?? []), ...(candidate.demographics ?? [])]),
  synopsis: clamp01(storySimilarity),
  title: clamp01(textSimilarity(titleText(target), titleText(candidate))),
  metadata: metadataSimilarity(target, candidate),
  demographics: setSimilarity(target.demographics ?? [], candidate.demographics ?? []),
  studios: setSimilarity(target.studios ?? [], candidate.studios ?? []),
  format: target.format && candidate.format && target.format === candidate.format ? 1 : 0,
  year: closeness(target.year, candidate.year, 10),
  score: closeness(target.score, candidate.score, 2),
  popularity: inverseRankCloseness(target.popularity ?? target.rank, candidate.popularity ?? candidate.rank, 1200),
});

const weightedScore = (breakdown: SimilarityBreakdown) =>
  breakdown.genres * 0.34 +
  breakdown.themes * 0.24 +
  breakdown.synopsis * 0.23 +
  breakdown.metadata * 0.14 +
  breakdown.title * 0.05;

const clusterFor = (anime: Anime, target: Anime) => {
  const animeGenres = anime.genres ?? [];
  const targetGenres = target.genres ?? [];
  const animeThemes = anime.themes ?? [];
  const targetThemes = target.themes ?? [];
  const shared = animeGenres.filter((genre) => targetGenres.includes(genre));
  if (shared.includes("Action") && shared.includes("Fantasy")) return "Battle fantasy";
  if (shared.includes("Drama") && (animeGenres.includes("Romance") || targetGenres.includes("Romance"))) return "Emotional drama";
  if (shared.includes("Sci-Fi") || animeThemes.includes("Mecha") || targetThemes.includes("Mecha")) return "Speculative systems";
  if (animeThemes.includes("School") || targetThemes.includes("School")) return "School energy";
  if (shared.includes("Comedy")) return "Comedic pace";
  if (shared.length) return `${shared[0]} neighbors`;
  return "Nearby mood";
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) => (count === 1 ? singular : plural);

const joinShortList = (values: string[], max = 3) => {
  const shown = values.slice(0, max);
  const extra = values.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} +${extra}` : shown.join(", ");
};

export const formatSimilarityScore = (score: number) => `${Math.round(clamp01(score) * 100)}%`;

const factorDetail = (items: string[], emptyDetail = "") => (items.length ? joinShortList(items) : emptyDetail);

export const getTopRecommendationReasons = (explanation: RecommendationExplanation) => {
  const specific = explanation.factorBreakdown
    .filter((factor) => factor.value > 0 && factor.detail)
    .sort((left, right) => right.value - left.value)
    .map((factor) => `${factor.label}: ${factor.detail}`);

  if (!specific.length) return ["Recommended based on overall metadata similarity."];
  return specific.slice(0, 3);
};

export const buildRecommendationExplanation = (
  target: Anime,
  candidate: Anime,
  breakdown: SimilarityBreakdown,
  totalScore: number,
): RecommendationExplanation => {
  const matchedGenres = sharedValues(target.genres, candidate.genres);
  const matchedThemes = sharedValues(target.themes, candidate.themes);
  const matchedDemographics = sharedValues(target.demographics, candidate.demographics);
  const matchedStudios = sharedValues(target.studios, candidate.studios);
  const formatMatch = Boolean(target.format && candidate.format && target.format === candidate.format);
  const yearGap =
    typeof target.year === "number" && typeof candidate.year === "number" ? Math.abs(target.year - candidate.year) : undefined;
  const scoreGap =
    typeof target.score === "number" && typeof candidate.score === "number" ? Math.abs(target.score - candidate.score) : undefined;

  const factorBreakdown: RecommendationFactor[] = [
    {
      key: "genres",
      label: "Genres",
      value: breakdown.genres,
      detail: factorDetail(matchedGenres),
    },
    {
      key: "themes",
      label: "Themes",
      value: setSimilarity(target.themes ?? [], candidate.themes ?? []),
      detail: factorDetail(matchedThemes),
    },
    {
      key: "demographics",
      label: "Demographic",
      value: breakdown.demographics,
      detail: factorDetail(matchedDemographics),
    },
    {
      key: "synopsis",
      label: "Synopsis",
      value: breakdown.synopsis,
      detail: breakdown.synopsis > 0.08 ? "story text overlaps" : "",
    },
    {
      key: "format",
      label: "Format",
      value: breakdown.format,
      detail: formatMatch ? `same ${candidate.format} format` : "",
    },
    {
      key: "studio",
      label: "Studio",
      value: breakdown.studios,
      detail: factorDetail(matchedStudios),
    },
    {
      key: "year",
      label: "Year",
      value: breakdown.year,
      detail: yearGap !== undefined && breakdown.year >= 0.5 ? `${yearGap} ${pluralize(yearGap, "year")} apart` : "",
    },
    {
      key: "score",
      label: "Popularity/score metadata",
      value: Math.max(breakdown.score, breakdown.popularity),
      detail: scoreGap !== undefined && breakdown.score >= 0.5 ? `MAL scores within ${scoreGap.toFixed(1)}` : "",
    },
    {
      key: "title",
      label: "Title",
      value: breakdown.title,
      detail: breakdown.title > 0.12 ? "title wording overlaps" : "",
    },
  ].map((factor) => ({ ...factor, value: clamp01(factor.value) }));

  const explanationBase: RecommendationExplanation = {
    totalScore,
    summary: "Recommended based on overall metadata similarity.",
    factorBreakdown,
    matchedGenres,
    matchedThemes,
    matchedDemographics,
    matchedStudios,
    formatMatch,
    yearCloseness: breakdown.year,
    scoreCloseness: breakdown.score,
    popularityCloseness: breakdown.popularity,
    synopsisSimilarity: breakdown.synopsis,
    titleSimilarity: breakdown.title,
    topReasons: [],
  };

  const topReasons = getTopRecommendationReasons(explanationBase);
  const primaryReasons = [
    matchedGenres.length ? `${matchedGenres.length} shared ${pluralize(matchedGenres.length, "genre")}` : "",
    matchedThemes.length ? `${matchedThemes.length} shared ${pluralize(matchedThemes.length, "theme")}` : "",
    matchedDemographics.length ? `same ${joinShortList(matchedDemographics, 1)} audience tag` : "",
    matchedStudios.length ? `same studio` : "",
    formatMatch ? `same ${candidate.format} format` : "",
    breakdown.synopsis > 0.12 ? "similar synopsis wording" : "",
  ].filter(Boolean);

  return {
    ...explanationBase,
    summary: primaryReasons.length ? `Matches on ${primaryReasons.slice(0, 3).join(", ")}.` : explanationBase.summary,
    topReasons,
  };
};

export const recommendAnime = (target: Anime, catalog: Anime[], count: number): Recommendation[] => {
  const targetFranchise = franchiseKey(target);
  const seenFranchises = new Set<string>();
  const idf = buildIdf(catalog);
  const targetStoryVector = vectorizeText(target.synopsis ?? "", idf);

  return catalog
    .filter((anime) => anime.id !== target.id && anime.malId !== target.malId)
    .filter((anime) => !isLikelyContinuation(anime))
    .filter((anime) => franchiseKey(anime) !== targetFranchise)
    .map((anime) => {
      const storySimilarity = cosineSimilarity(targetStoryVector, vectorizeText(anime.synopsis ?? "", idf));
      const breakdown = buildBreakdown(target, anime, storySimilarity);
      const score = weightedScore(breakdown);
      const explanation = buildRecommendationExplanation(target, anime, breakdown, score);
      return {
        anime,
        score,
        cluster: clusterFor(anime, target),
        reasons: explanation.topReasons,
        breakdown,
        explanation,
      };
    })
    .sort((left, right) => right.score - left.score)
    .filter((recommendation) => {
      const key = franchiseKey(recommendation.anime);
      if (seenFranchises.has(key)) return false;
      seenFranchises.add(key);
      return true;
    })
    .slice(0, count);
};

const cleanNumber = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const normalizedGenreSet = (genres: string[] | undefined) => new Set((genres ?? []).map(normalize));

export const clearRecommendationFilters = (): RecommendationFilters => ({
  format: "",
  minYear: undefined,
  maxYear: undefined,
  minScore: undefined,
  maxPopularity: undefined,
  includeGenres: [],
  excludeGenres: [],
});

export const hasActiveRecommendationFilters = (filters: RecommendationFilters) =>
  Boolean(
    filters.format ||
      cleanNumber(filters.minYear) !== undefined ||
      cleanNumber(filters.maxYear) !== undefined ||
      cleanNumber(filters.minScore) !== undefined ||
      cleanNumber(filters.maxPopularity) !== undefined ||
      (filters.includeGenres?.length ?? 0) > 0 ||
      (filters.excludeGenres?.length ?? 0) > 0,
  );

export const getAvailableRecommendationGenres = (results: Recommendation[]) =>
  [...new Set(results.flatMap((result) => result.anime.genres ?? []).filter(Boolean))].sort((left, right) => left.localeCompare(right));

export const getAvailableRecommendationFormats = (results: Recommendation[]) =>
  [...new Set(results.map((result) => result.anime.format).filter(Boolean))].sort((left, right) => left.localeCompare(right));

export const applyRecommendationFilters = (results: Recommendation[], filters: RecommendationFilters) => {
  const minYear = cleanNumber(filters.minYear);
  const maxYear = cleanNumber(filters.maxYear);
  const startYear = minYear !== undefined && maxYear !== undefined ? Math.min(minYear, maxYear) : minYear;
  const endYear = minYear !== undefined && maxYear !== undefined ? Math.max(minYear, maxYear) : maxYear;
  const minScore = cleanNumber(filters.minScore);
  const maxPopularity = cleanNumber(filters.maxPopularity);
  const includeGenres = (filters.includeGenres ?? []).map(normalize).filter(Boolean);
  const excludeGenres = (filters.excludeGenres ?? []).map(normalize).filter(Boolean);

  return results.filter((result) => {
    const { anime } = result;
    const year = cleanNumber(anime.year);
    const score = cleanNumber(anime.score);
    const popularity = cleanNumber(anime.popularity);
    const genres = normalizedGenreSet(anime.genres);

    return (
      (!filters.format || anime.format === filters.format) &&
      (startYear === undefined || (year !== undefined && year >= startYear)) &&
      (endYear === undefined || (year !== undefined && year <= endYear)) &&
      (minScore === undefined || (score !== undefined && score >= minScore)) &&
      (maxPopularity === undefined || (popularity !== undefined && popularity <= maxPopularity)) &&
      includeGenres.every((genre) => genres.has(genre)) &&
      excludeGenres.every((genre) => !genres.has(genre))
    );
  });
};

const missingHigh = Number.POSITIVE_INFINITY;
const missingLow = Number.NEGATIVE_INFINITY;

export const sortRecommendationResults = (results: Recommendation[], sortMode: RecommendationSortMode) => {
  const sorted = [...results];

  sorted.sort((left, right) => {
    switch (sortMode) {
      case "score_desc":
        return (right.anime.score ?? missingLow) - (left.anime.score ?? missingLow) || right.score - left.score;
      case "popularity_asc":
        return (
          (left.anime.popularity ?? missingHigh) - (right.anime.popularity ?? missingHigh) ||
          (left.anime.rank ?? missingHigh) - (right.anime.rank ?? missingHigh) ||
          right.score - left.score
        );
      case "year_desc":
        return (right.anime.year ?? missingLow) - (left.anime.year ?? missingLow) || right.score - left.score;
      case "title_asc":
        return titleForKey(left.anime).localeCompare(titleForKey(right.anime)) || right.score - left.score;
      case "similarity_desc":
      default:
        return right.score - left.score || titleForKey(left.anime).localeCompare(titleForKey(right.anime));
    }
  });

  return sorted;
};

export const findAnime = (query: string, catalog: Anime[]): SearchMatch[] => {
  const normalizedQuery = normalize(query);
  const malId = extractMalId(query);

  return catalog
    .map((anime) => {
      const titleScore = Math.max(
        textSimilarity(normalizedQuery, anime.title.romaji),
        anime.title.english ? textSimilarity(normalizedQuery, anime.title.english) : 0,
        anime.title.native ? textSimilarity(normalizedQuery, anime.title.native) : 0,
      );
      const exactBoost =
        normalize(anime.title.romaji) === normalizedQuery || normalize(anime.title.english ?? "") === normalizedQuery ? 1 : 0;
      const idBoost = malId && anime.malId === malId ? 1.2 : 0;
      return { anime, score: Math.max(titleScore, exactBoost) + idBoost };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score);
};

export const extractMalId = (value: string) => {
  const match = value.match(/myanimelist\.net\/anime\/(\d+)/i);
  return match ? Number(match[1]) : undefined;
};

export const percent = (value: number) => Math.round(clamp01(value) * 100);

export const tenPoint = (value: number) => Math.round(value * 10);

export const relativePercent = (value: number, maxValue: number) => {
  if (value <= 0 || maxValue <= 0) return 0;
  return Math.round(Math.min(100, Math.max(8, (value / maxValue) * 100)));
};

export const matchStrength = (score: number, topScore: number) => {
  if (score <= 0 || topScore <= 0) return 0;
  const relative = score / topScore;
  return Math.round(Math.min(98, Math.max(35, 55 + relative * 40)));
};

export const strengthTone = (strength: number) => {
  if (strength >= 88) return "strong";
  if (strength >= 72) return "good";
  if (strength >= 56) return "moderate";
  return "light";
};

export const factorPercent = percent;
