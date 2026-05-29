export function extractMalId(value) {
  const match = value.match(/myanimelist\.net\/anime\/(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

export function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findExistingAnime(catalog, query) {
  const malId = extractMalId(query);
  if (malId) return catalog.find((anime) => anime.malId === malId);

  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return undefined;

  const exact = catalog.find((anime) => {
    const titles = getTitles(anime);
    return titles.some((title) => title === normalizedQuery);
  });

  if (exact) return exact;

  return catalog.find((anime) => {
    const titles = getTitles(anime);
    return titles.some((title) => {
      if (!title.includes(normalizedQuery)) return false;
      const suffix = title.slice(title.indexOf(normalizedQuery) + normalizedQuery.length).trim();
      return !/^(?:\d+|season|part|2nd|3rd|4th)\b/i.test(suffix);
    });
  });
}

export function pickBestSearchResult(results, query) {
  return [...results].sort((left, right) => {
    const titleDelta = titleMatchScore(right, query) - titleMatchScore(left, query);
    if (titleDelta) return titleDelta;
    return (right.score ?? 0) - (left.score ?? 0);
  })[0];
}

function titleMatchScore(anime, query) {
  const normalizedQuery = normalize(query);
  const titles = getTitles(anime);
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

function getTitles(anime) {
  return [anime.title?.english, anime.title?.romaji, anime.title?.native].filter(Boolean).map(normalize);
}
