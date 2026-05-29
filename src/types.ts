export type AnimeSource = "local" | "jikan" | "mal";

export interface AnimeTitle {
  english?: string;
  romaji: string;
  native?: string;
}

export interface Anime {
  id: number;
  malId?: number;
  title: AnimeTitle;
  imageUrl: string;
  synopsis: string;
  genres: string[];
  themes: string[];
  demographics: string[];
  studios: string[];
  year?: number;
  format: "TV" | "Movie" | "OVA" | "ONA" | "Special";
  episodes?: number;
  score?: number;
  rank?: number;
  popularity?: number;
  rankingTypes?: string[];
  source: AnimeSource;
}

export interface SimilarityBreakdown {
  genres: number;
  themes: number;
  synopsis: number;
  title: number;
  metadata: number;
}

export interface Recommendation {
  anime: Anime;
  score: number;
  cluster: string;
  reasons: string[];
  breakdown: SimilarityBreakdown;
}

export interface SearchMatch {
  anime: Anime;
  score: number;
}
