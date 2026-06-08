# AnimeRec

AnimeRec is a polished React/Vite demo for exploring anime recommendations. It combines an explainable metadata recommender with optional pgvector semantic similarity, so the same title can be explored through Metadata, Semantic, and Hybrid modes without exposing database secrets, raw vectors, or embedding internals to the browser.

## Core features

- Search by anime title or MyAnimeList anime URL.
- Browse the loaded catalog with title/synopsis search, metadata filters, score filters, and sorting.
- Open detail pages with poster art, fallback posters, synopsis, metadata, source info, MAL links, and nearby recommendations.
- Generate recommendations from the search panel, catalog cards, detail pages, recommendation cards, or graph nodes.
- Filter recommendation results by format, year range, and score range.
- Sort active recommendations by Match, Score, or year.
- Visualize the visible recommendation neighborhood in the Network graph.
- Fall back to bundled/local catalog recommendations when remote lookup or semantic similarity is unavailable.
- Use a light/dark theme toggle for demo-friendly viewing.

## Recommendation modes

- Metadata: deterministic local matching using genres, themes, demographics, studios, format, year, score/popularity metadata, title overlap, and synopsis text similarity. Cards label this as Metadata match.
- Semantic: server-side pgvector nearest neighbors from stored anime embeddings. Cards label this as Semantic match and do not show raw vectors or database details.
- Hybrid: a 65% Metadata and 35% Semantic blend. Cards label this as Hybrid match and show available Metadata, Semantic, and Hybrid score chips.

Metadata mode remains usable when the vector endpoint is missing, unavailable, or not configured. Semantic and Hybrid modes show friendly status/empty states instead of raw server errors.

## Tech stack

- React 19 and TypeScript
- Vite
- CSS modules via a single app stylesheet
- lucide-react icons
- Local JSON catalog for portable demo data
- Optional local Node API for catalog lookup and vector similarity
- Optional Neon Postgres with pgvector for stored semantic neighbors
- Vercel serverless functions under `api/`

## Local setup

```bash
npm install
npm run dev:api
npm run dev
```

Run the API and Vite app in separate terminals. Open the local URL printed by Vite.

Create an ignored `.env` file when using MAL lookup, Neon, or embedding generation:

```bash
MAL_CLIENT_ID=your_client_id_here
MAL_CLIENT_SECRET=your_client_secret_here
MAL_RATE_LIMIT_PER_SECOND=2
DATABASE_URL=your_neon_pooled_connection_string
VITE_ANIMEREC_API_URL=http://127.0.0.1:8787
```

Only `VITE_*` variables are bundled into browser JavaScript. Keep MAL secrets, database URLs, and API keys out of `VITE_*`.

## Catalog and MAL data

The app ships with a bundled catalog and can also use the local API catalog. To refresh the local MAL-backed JSON snapshot:

```bash
npm run sync:mal
```

The sync script writes deduplicated records to `src/data/animeCatalog.json` and throttles requests with `MAL_RATE_LIMIT_PER_SECOND`.

To upload the local catalog into Neon:

```bash
npm run db:migrate
npm run db:import
```

## Neon and pgvector notes

Semantic mode depends on precomputed embeddings stored in Neon Postgres with pgvector. The app never stores vectors in `src/data/animeCatalog.json`, and the vector API returns only source metadata, score type, limit, and similar anime results.

Add embedding generation values to `.env` only in trusted local/server environments:

```bash
DATABASE_URL=your_neon_pooled_connection_string
OPENAI_API_KEY=your_openai_api_key
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_BATCH_SIZE=25
EMBEDDING_BATCH_DELAY_MS=10000
EMBEDDING_MAX_RETRIES=5
EMBEDDING_LIMIT=
```

Run a small smoke test first:

```bash
EMBEDDING_LIMIT=3 npm run embeddings:generate
```

Then run a larger sample or omit `EMBEDDING_LIMIT` for the full catalog. The script hashes deterministic embedding text and skips unchanged rows for the same anime/model combination.

## Vector similarity API

The backend exposes pgvector neighbors at:

```bash
GET /api/vector-similar?animeId=5114&limit=20
```

`animeId` is the MAL/anime ID stored in Neon. `limit` defaults to 20 and is clamped between 1 and 50. The endpoint compares existing stored embeddings only; it does not call embedding generation during normal browsing.

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

## Deployment notes

On Vercel, leave `VITE_ANIMEREC_API_URL` unset so the frontend calls same-origin `/api` routes. Configure server-only environment variables such as `MAL_CLIENT_ID`, `MAL_CLIENT_SECRET`, `MAL_RATE_LIMIT_PER_SECOND`, and `DATABASE_URL` in the Vercel project settings.

The deployed demo is designed to remain usable even if Neon or pgvector is not configured: Metadata recommendations, Catalog, Detail, filters, sorting, poster fallbacks, and the Network graph still work from local catalog data.

## Build

```bash
npm run build
```

## Future improvements

- Add route-level URLs for sharing a selected anime or catalog filter.
- Add richer graph controls once the demo has a larger production catalog.
- Expand automated interaction tests around mode switching and API failure states.
- Improve catalog ingestion coverage for sparse or obscure anime records.
