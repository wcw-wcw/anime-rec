# AnimeRec

A React/Vite anime recommendation prototype. It works today with a local starter catalog and is structured so MyAnimeList or Jikan data can be added without rewriting the UI or recommender.

## What is built

- Search by anime title or MyAnimeList anime URL.
- Browse the loaded catalog with title/synopsis search, metadata filters, and sorting.
- Open anime detail views with poster art, synopsis, metadata, source info, and similar recommendations.
- Choose how many recommendations to return.
- Local similarity engine using genres, themes, demographics, synopsis/title token overlap, format, year, and studio.
- Cluster labels for nearby groups such as battle fantasy, emotional drama, and speculative systems.
- Provider layer for local data, Jikan fallback, and MyAnimeList API access.

## Catalog browsing

Use the Catalog tab to browse every anime currently loaded into the app. The catalog supports search across titles and synopses, genre/format/year filters, minimum score filtering, and sorting by popularity, score, year, title, or rank.

Catalog cards use the same local/API-loaded anime records as the recommendation flow. Today that means bundled seed data plus the local JSON/API catalog when available; later this view is a natural candidate for Neon-backed querying once the dataset grows beyond what should be filtered in the browser.

## Anime detail view

Catalog cards, recommendation cards, and the currently selected source anime can open a detail view. Details include poster fallback handling, romaji/native titles, synopsis, score, rank, popularity, format/year/episodes, studios, genres, themes, demographics, source metadata, and MyAnimeList links when available.

The detail view uses the currently loaded local/API catalog and the existing metadata recommender to show similar anime. It can also start a fresh recommendation run from the displayed anime without introducing separate routes or authentication.

## Explainable recommendations

Recommendations are currently rule/metadata-based and deterministic. The app ranks titles with shared genres, themes, demographics, synopsis text similarity, title overlap, format, year, studio, and score/popularity metadata.

Recommendation cards show a similarity score, a short "Why this matches" summary, top match reasons, and factor bars for the strongest scoring signals. These explanations are intended to describe the current metadata scorer honestly; vector or embedding similarity is a future enhancement, not part of the current recommender.

## Recommendation filters

The Recommend view includes a compact filter popover next to the result-count slider. Users can narrow the explainable metadata-based candidate pool by format, score range, and year range before the app fills the requested number of recommendation cards.

The visible results can also be sorted by match percentage, age, or score. These controls filter and sort the current deterministic recommendation results; they do not change the underlying scoring weights. Vector similarity search is planned as the next major recommendation-quality upgrade.

## Run it

```bash
npm install
npm run dev:api
npm run dev
```

Run the API and Vite app in separate terminals. Then open the local URL Vite prints.

## MyAnimeList API setup

Create a `.env` file:

```bash
MAL_CLIENT_ID=your_client_id_here
MAL_CLIENT_SECRET=your_client_secret_here
MAL_RATE_LIMIT_PER_SECOND=2
DATABASE_URL=your_neon_pooled_connection_string
VITE_ANIMEREC_API_URL=http://127.0.0.1:8787
```

The MAL credentials are used only by local Node scripts. Do not expose the client secret through `VITE_*` variables because those are bundled into browser JavaScript.

On Vercel, set `MAL_CLIENT_ID`, `MAL_CLIENT_SECRET`, and `MAL_RATE_LIMIT_PER_SECOND` as environment variables. Leave `VITE_ANIMEREC_API_URL` unset so the app calls same-origin `/api` routes.

## Sync MAL catalog data

Fetch and cache:

- Top 100 anime
- Top 100 airing anime
- Top 100 upcoming anime
- Top 100 TV anime
- Top 100 movies

```bash
npm run sync:mal
```

The sync script writes deduplicated records to `src/data/animeCatalog.json` and throttles requests with `MAL_RATE_LIMIT_PER_SECOND`, defaulting to 2 requests per second. Its current defaults request up to 3,500 ranked-list rows before deduplication.

## Upload local catalog to Neon

After attaching Neon and adding `DATABASE_URL` to your ignored `.env` file:

```bash
npm run db:migrate
npm run db:import
```

The import uploads your locally synced JSON snapshot to Neon. This keeps the larger MAL batch sync off Vercel and avoids unnecessary production API/database traffic.

## Vector similarity foundation

AnimeRec can now prepare semantic anime embeddings server-side without changing the visible recommender UI. Embeddings are generated locally or from a trusted server process with OpenAI `text-embedding-3-small` and stored in Neon Postgres using pgvector. No embedding vectors are committed into `src/data/animeCatalog.json`, and no OpenAI API key should ever use a `VITE_*` prefix.

The embedding text is deterministic and intentionally avoids volatile fields such as score, rank, and popularity. It includes romaji/native title, synopsis, genres, themes, demographics, studios, format, and year. The script hashes that final text and skips rows whose hash is already stored for the same anime and embedding model.

Add these values to your ignored `.env` file:

```bash
DATABASE_URL=your_neon_pooled_connection_string
OPENAI_API_KEY=your_openai_api_key
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_BATCH_SIZE=25
EMBEDDING_BATCH_DELAY_MS=10000
EMBEDDING_MAX_RETRIES=5
EMBEDDING_LIMIT=
```

Apply the pgvector migration after the base anime table is available:

```bash
npm run db:migrate
```

Run a small embedding test first:

```bash
EMBEDDING_LIMIT=3 npm run embeddings:generate
```

Run the same command again to confirm unchanged records are skipped. The default embedding pace is conservative for low OpenAI limits: 25 anime per request, at least 10 seconds between batches, and up to 5 retries for rate-limit or temporary server errors. The script logs approximate input tokens per batch, but never logs API keys, database URLs, or full embedding vectors.

For a larger smoke test:

```bash
EMBEDDING_LIMIT=100 npm run embeddings:generate
```

Then run the full generation with no `EMBEDDING_LIMIT`. This step only creates the storage foundation; the current Recommend, Catalog, Detail, filters, sorting, and explanation flows still use the existing explainable metadata scorer. The next planned step is a vector similarity API and a hybrid metadata plus semantic recommender.

## Vector similarity API

The backend exposes a validation endpoint for stored pgvector neighbors:

```bash
GET /api/vector-similar?animeId=5114&limit=20
```

`animeId` is the MAL/anime ID stored in Neon. `limit` is optional, defaults to 20, and is clamped between 1 and 50. The endpoint does not call OpenAI; it compares existing stored embeddings only, using cosine distance in Neon/Postgres.

Example response shape:

```json
{
  "source": {
    "id": 5114,
    "malId": 5114,
    "title": {
      "romaji": "Fullmetal Alchemist: Brotherhood"
    }
  },
  "embeddingModel": "text-embedding-3-small",
  "scoreType": "vector_semantic_similarity",
  "limit": 20,
  "similar": [
    {
      "anime": {
        "id": 121,
        "malId": 121,
        "title": {
          "romaji": "Fullmetal Alchemist"
        },
        "genres": ["Action", "Adventure", "Drama", "Fantasy"],
        "format": "TV",
        "year": 2003
      },
      "vectorDistance": 0.12,
      "vectorSimilarity": 88
    }
  ]
}
```

This is currently a backend validation endpoint, not part of the visible recommender UI. It does not return raw vectors, API keys, or database connection details. The next planned step is blending this semantic signal with the existing explainable metadata recommender.

## Persistent lookup while developing

Run the local API in one terminal:

```bash
npm run dev:api
```

Run the React app in another:

```bash
npm run dev
```

When a user searches for a title or MAL URL, the app checks local JSON storage first. If the local API is running and the anime is missing, it fetches the anime from MAL, appends it to `src/data/animeCatalog.json`, and returns recommendations against the updated catalog.


## Data plan

Avoid scraping as the primary source unless a site explicitly allows it. A better path is:

1. Use MAL API for exact title/URL lookup and detail hydration.
2. Store local development data in JSON because it is portable, diffable, and easy to migrate.
3. Move the same record shape into SQLite/Postgres/Supabase once the catalog and user features grow.
4. Precompute vectors for each anime so recommendations stay fast as the catalog grows.
5. Add collaborative signals later from user ratings/watchlists once authentication exists.
