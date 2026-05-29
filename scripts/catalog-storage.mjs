import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const catalogPath = resolve("src/data/animeCatalog.json");

export async function readCatalog(path = catalogPath) {
  try {
    const contents = await readFile(path, "utf8");
    const parsed = JSON.parse(contents);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function writeCatalog(catalog, path = catalogPath) {
  await mkdir(dirname(path), { recursive: true });
  const ordered = [...catalog].sort((left, right) => {
    const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || (left.malId ?? left.id) - (right.malId ?? right.id);
  });
  await writeFile(path, `${JSON.stringify(ordered, null, 2)}\n`);
}

export function mergeAnimeCatalog(existing, incoming) {
  const byId = new Map();

  for (const anime of existing) {
    byId.set(anime.malId ?? anime.id, anime);
  }

  for (const anime of incoming) {
    const key = anime.malId ?? anime.id;
    const current = byId.get(key);
    byId.set(key, current ? mergeAnime(current, anime) : anime);
  }

  return [...byId.values()];
}

function mergeAnime(current, incoming) {
  return {
    ...current,
    ...incoming,
    title: { ...current.title, ...incoming.title },
    synopsis: incoming.synopsis || current.synopsis,
    imageUrl: incoming.imageUrl || current.imageUrl,
    genres: mergeStrings(current.genres, incoming.genres),
    themes: mergeStrings(current.themes, incoming.themes),
    demographics: mergeStrings(current.demographics, incoming.demographics),
    studios: mergeStrings(current.studios, incoming.studios),
    rankingTypes: mergeStrings(current.rankingTypes, incoming.rankingTypes),
    rank: Math.min(current.rank ?? Number.MAX_SAFE_INTEGER, incoming.rank ?? Number.MAX_SAFE_INTEGER),
  };
}

function mergeStrings(left = [], right = []) {
  return [...new Set([...left, ...right].filter(Boolean))];
}
