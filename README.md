# AnimeRec

A React/Vite anime recommendation prototype. It works today with a local starter catalog and is structured so MyAnimeList or Jikan data can be added without rewriting the UI or recommender.

## What is built

- Search by anime title or MyAnimeList anime URL.
- Choose how many recommendations to return.
- Local similarity engine using genres, themes, demographics, synopsis/title token overlap, format, year, and studio.
- Cluster labels for nearby groups such as battle fantasy, emotional drama, and speculative systems.
- Provider layer for local data, Jikan fallback, and MyAnimeList API access.

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

The sync script writes deduplicated records to `src/data/animeCatalog.json` and throttles requests with `MAL_RATE_LIMIT_PER_SECOND`, defaulting to 2 requests per second.

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

## Deploy

See [DEPLOYMENT.md](./DEPLOYMENT.md) for Vercel setup, persistence tradeoffs, and provider options.

## Data plan

Avoid scraping as the primary source unless a site explicitly allows it. A better path is:

1. Use MAL API for exact title/URL lookup and detail hydration.
2. Store local development data in JSON because it is portable, diffable, and easy to migrate.
3. Move the same record shape into SQLite/Postgres/Supabase once the catalog and user features grow.
4. Precompute vectors for each anime so recommendations stay fast as the catalog grows.
5. Add collaborative signals later from user ratings/watchlists once authentication exists.
