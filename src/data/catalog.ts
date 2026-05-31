import { seedAnime } from "./seedAnime";
import type { Anime } from "../types";

// Keep the browser bundle light. The full JSON/Neon catalog is loaded through /api/catalog.
export const localCatalog: Anime[] = seedAnime;
