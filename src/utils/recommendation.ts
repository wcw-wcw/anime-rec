import type { Anime, Recommendation, SearchMatch, SimilarityBreakdown } from "../types";

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
  synopsis: storySimilarity,
  title: textSimilarity(titleText(target), titleText(candidate)),
  metadata: metadataSimilarity(target, candidate),
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

const reasonFor = (target: Anime, candidate: Anime, breakdown: SimilarityBreakdown) => {
  const reasons: string[] = [];
  const targetStudios = target.studios ?? [];
  const sharedGenres = (candidate.genres ?? []).filter((genre) => (target.genres ?? []).includes(genre));
  const sharedThemes = [...(candidate.themes ?? []), ...(candidate.demographics ?? [])].filter((theme) =>
    [...(target.themes ?? []), ...(target.demographics ?? [])].includes(theme),
  );

  if (sharedGenres.length) reasons.push(`Shares ${sharedGenres.slice(0, 3).join(", ")}`);
  if (sharedThemes.length) reasons.push(`Matches ${sharedThemes.slice(0, 2).join(", ")}`);
  if (breakdown.synopsis > 0.12) reasons.push("Synopsis language overlaps");
  if ((candidate.studios ?? []).some((studio) => targetStudios.includes(studio))) {
    reasons.push(`Same studio: ${(candidate.studios ?? []).find((studio) => targetStudios.includes(studio))}`);
  }
  if (candidate.format === target.format) reasons.push(`Same format: ${candidate.format}`);

  return reasons.slice(0, 3);
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
      return {
        anime,
        score,
        cluster: clusterFor(anime, target),
        reasons: reasonFor(target, anime, breakdown),
        breakdown,
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

export const percent = (value: number) => Math.round(value * 100);

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
