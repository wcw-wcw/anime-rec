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
  demographics: number;
  studios: number;
  format: number;
  year: number;
  score: number;
  popularity: number;
}

export interface RecommendationFactor {
  key: string;
  label: string;
  value: number;
  detail?: string;
}

export interface RecommendationExplanation {
  totalScore: number;
  summary: string;
  factorBreakdown: RecommendationFactor[];
  matchedGenres: string[];
  matchedThemes: string[];
  matchedDemographics: string[];
  matchedStudios: string[];
  formatMatch: boolean;
  yearCloseness: number;
  scoreCloseness: number;
  popularityCloseness: number;
  synopsisSimilarity: number;
  titleSimilarity: number;
  topReasons: string[];
}

export interface Recommendation {
  anime: Anime;
  score: number;
  cluster: string;
  reasons: string[];
  breakdown: SimilarityBreakdown;
  explanation: RecommendationExplanation;
  mode?: RecommendationMode;
  metadataScore?: number;
  vectorSimilarity?: number;
  hybridScore?: number;
  showMetadataFactors?: boolean;
}

export type RecommendationMode = "metadata" | "semantic" | "hybrid";

export interface VectorSimilarAnimeResult {
  anime: Anime;
  vectorDistance?: number;
  vectorSimilarity: number;
}

export interface VectorSimilarAnimeResponse {
  source: Pick<Anime, "id" | "malId" | "title">;
  embeddingModel: string;
  scoreType: "vector_semantic_similarity";
  limit: number;
  similar: VectorSimilarAnimeResult[];
}

export interface HybridRecommendationResult extends Recommendation {
  mode: "hybrid";
  metadataScore: number;
  vectorSimilarity: number;
  hybridScore: number;
}

export type RecommendationSortMode = "similarity_desc" | "score_desc" | "popularity_asc" | "year_desc" | "title_asc";

export interface RecommendationFilters {
  format?: string;
  minYear?: number;
  maxYear?: number;
  minScore?: number;
  maxScore?: number;
}

export interface SearchMatch {
  anime: Anime;
  score: number;
}
