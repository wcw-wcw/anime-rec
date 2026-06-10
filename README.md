# AnimeRec

AnimeRec is a React/Vite portfolio demo for exploring anime recommendations. It can run entirely from a bundled JSON catalog, or it can use a local/Vercel API backed by MyAnimeList data, Neon Postgres, and pgvector semantic neighbors.

The app intentionally stays small: no auth, no watch lists, no user accounts, and no MAL replacement features. The goal is to demonstrate resilient recommendation UX, explainable scoring, semantic search infrastructure, and production-minded deployment boundaries.

## Core Features

- Search by anime title or MyAnimeList anime URL.
- Browse the loaded catalog with title/synopsis search, genre, format, year, score filters, and sorting.
- Open detail pages with poster art, fallback posters, synopsis, metadata, source info, MAL links, and nearby recommendations.
- Generate recommendations from search, catalog cards, detail pages, recommendation cards, and graph nodes.
- Switch between Metadata, Semantic, and Hybrid recommendation modes.
- Filter recommendations by format, year range, and score range.
- Sort active recommendations by match, score, or year.
- Visualize visible recommendations in the Network graph.
- Keep Metadata mode usable when the API, database, or pgvector endpoint is unavailable.
- Toggle light/dark theme.

## Recommendation Modes

- Metadata: deterministic local matching over genres, themes, demographics, studios, format, year, MAL score/popularity, title overlap, and local synopsis TF-IDF similarity.
- Semantic: server-side pgvector nearest neighbors from stored anime embeddings. The browser receives anime records and similarity scores, not raw vectors.
- Hybrid: a 65% Metadata and 35% Semantic blend. Hybrid results can include metadata-only or semantic-only records when the two sources do not fully overlap.

## Tech Stack

- React 19
- TypeScript
- Vite
- CSS in `src/styles.css`
- lucide-react icons
- Local JSON catalog in `src/data/animeCatalog.json`
- Optional local Node API in `scripts/catalog-api.mjs`
- Vercel serverless routes in `api/`
- Neon serverless Postgres driver
- pgvector for semantic similarity
- OpenAI embeddings generated only from trusted local/server scripts

## Project Structure

```text
api/                         Vercel serverless API routes
database/migrations/         SQL migrations for pgvector embedding storage
scripts/                     Local data sync, import, migration, and embedding jobs
src/App.tsx                  Main React app and view orchestration
src/data/                    Bundled seed/catalog data
src/services/animeProvider.ts Frontend provider layer for local/API/Jikan data
src/utils/catalog.ts         Catalog filtering, sorting, and display helpers
src/utils/recommendation.ts  Metadata, Semantic, and Hybrid recommendation logic
src/styles.css               Application styling and responsive behavior
```

## Setup

Install dependencies:

```bash
npm install
```

Run the local API and Vite dev server in separate terminals:

```bash
npm run dev:api
npm run dev
```

Then open the URL printed by Vite, usually `http://127.0.0.1:5173/`.

The app can still run with only `npm run dev`; it will use the bundled catalog and fall back gracefully when API-backed features are unavailable.

## Environment Variables

Copy `.env.example` to `.env` for local API/database/embedding work:

```bash
MAL_CLIENT_ID=
MAL_CLIENT_SECRET=
MAL_RATE_LIMIT_PER_SECOND=2
DATABASE_URL=
OPENAI_API_KEY=
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_BATCH_SIZE=25
EMBEDDING_BATCH_DELAY_MS=10000
EMBEDDING_MAX_RETRIES=5
EMBEDDING_LIMIT=
MAL_SYNC_ALL_LIMIT=1000
MAL_SYNC_AIRING_LIMIT=500
MAL_SYNC_UPCOMING_LIMIT=500
MAL_SYNC_TV_LIMIT=1000
MAL_SYNC_MOVIE_LIMIT=500
VITE_ANIMEREC_API_URL=http://127.0.0.1:8787
```

Important boundaries:

- `VITE_ANIMEREC_API_URL` is browser-visible. Use it only for the public API base URL.
- `MAL_CLIENT_ID`, `MAL_CLIENT_SECRET`, `DATABASE_URL`, and `OPENAI_API_KEY` must stay server/local only.
- Leave `VITE_ANIMEREC_API_URL` unset on Vercel so the app calls same-origin `/api` routes.
- `MAL_CLIENT_SECRET` is currently present for deployment consistency, but MAL requests in this code use `MAL_CLIENT_ID`.

## Scripts

```bash
npm run dev
```

Starts the Vite frontend on `127.0.0.1`.

```bash
npm run dev:api
```

Starts the local Node API on `127.0.0.1:8787`. It reads/writes `src/data/animeCatalog.json` for lookup persistence and uses Neon for vector similarity when `DATABASE_URL` is configured.

```bash
npm run sync:mal
```

Fetches MAL ranking pages and merges them into `src/data/animeCatalog.json`.

```bash
npm run db:migrate
```

Creates the `animerec` schema, `animerec.anime` table, and `animerec.anime_embeddings` table. Requires `DATABASE_URL`.

```bash
npm run db:import
```

Uploads the local JSON catalog into Neon. Requires `DATABASE_URL`.

```bash
npm run embeddings:generate
```

Generates embeddings for catalog rows that already exist in Neon and upserts them into `animerec.anime_embeddings`. Requires `DATABASE_URL` and `OPENAI_API_KEY`.

```bash
npm run build
```

Runs TypeScript and builds the Vite app.

```bash
npm run preview
```

Serves the built Vite app locally.

There is no lint or test script configured in `package.json` right now.

## Data And Database

The app has three catalog sources:

- Bundled catalog: `src/data/animeCatalog.json`, imported through `src/data/catalog.ts`.
- Local API catalog: `scripts/catalog-api.mjs`, useful while developing and expanding the JSON catalog.
- Neon catalog: used by Vercel routes when `DATABASE_URL` is configured.

`animerec.anime` stores normalized anime records keyed by MAL ID. It is created by `ensureAnimeTable()` in `scripts/neon-db.mjs`.

`animerec.anime_embeddings` stores one vector per anime/model pair:

- `anime_id`
- `embedding_model`
- `embedding_text_hash`
- `embedding vector(1536)`
- timestamps

The migration also enables the `vector` extension. The embedding text hash prevents unnecessary re-embedding when deterministic source text has not changed.

## API Routes

```text
GET /api/catalog
```

Returns the Neon catalog when configured and non-empty; otherwise returns the JSON catalog.

```text
GET /api/anime/lookup?q=<title-or-mal-url>
```

Checks the active catalog first, then queries MAL for missing titles or MAL URLs. In production with Neon, found records are upserted into `animerec.anime`.

```text
GET /api/vector-similar?animeId=<mal-id>&limit=<1-50>
```

Returns pgvector nearest neighbors for a stored source embedding. It does not generate embeddings at request time and does not return raw vectors.

## Local Data Workflow

1. Add MAL credentials to `.env`.
2. Run `npm run sync:mal` to refresh `src/data/animeCatalog.json`.
3. Run `npm run db:migrate` with `DATABASE_URL`.
4. Run `npm run db:import` to upload the JSON catalog to Neon.
5. Run a small embedding pass:

```bash
EMBEDDING_LIMIT=3 npm run embeddings:generate
```

6. Re-run without `EMBEDDING_LIMIT` when ready.

## Deployment Notes

The intended deployment target is Vercel plus Neon:

- Build command: `npm run build`
- Output directory: `dist`
- Serverless routes: `api/`
- Required production env for MAL lookup: `MAL_CLIENT_ID`
- Required production env for persistence/vector similarity: `DATABASE_URL`
- Do not set `VITE_ANIMEREC_API_URL` in Vercel.
- Generate and import the large catalog/embeddings from a trusted local or server process, not from browser code.

The demo remains useful without Neon: Metadata mode, Catalog, Detail, filters, sorting, poster fallbacks, and the Network graph all work from local catalog data.

## Known Limitations

- No auth, user ratings, watch lists, or collaborative filtering.
- Semantic mode requires precomputed embeddings in Neon; it cannot synthesize vectors on demand.
- MAL taxonomy can be sparse for themes/demographics, so Metadata explanations vary by record quality.
- The local API writes to `src/data/animeCatalog.json`, which is convenient for development but not a production persistence strategy.
- `scripts/generate-embeddings.mjs` calls OpenAI directly and should only run in trusted environments.
- There are no automated tests or lint script configured yet.

## Future Improvements

- Add route-level URLs for sharing selected anime or catalog filters.
- Add focused tests for mode switching, API failure states, filters, and graph interactions.
- Add a lint script once coding standards settle.
- Expand catalog ingestion coverage for sparse or obscure anime records.
- Add optional graph controls when the production catalog grows.
