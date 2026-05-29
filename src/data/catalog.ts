import generatedCatalog from "./animeCatalog.json";
import { seedAnime } from "./seedAnime";
import type { Anime } from "../types";

const isAnimeArray = (value: unknown): value is Anime[] => Array.isArray(value);

export const localCatalog: Anime[] = isAnimeArray(generatedCatalog) && generatedCatalog.length > 0 ? generatedCatalog : seedAnime;
