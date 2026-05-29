# Deployment Guide

This project is ready for Vercel Hobby as a Vite frontend plus serverless API routes.

## Recommended First Deployment

Use Vercel for the app and serverless MAL proxy, with the bundled `src/data/animeCatalog.json` as the persistent starter catalog.

This means:

- The top-list catalog committed in the repo is persistent.
- MAL credentials stay server-side in Vercel environment variables.
- Missing anime can be fetched at runtime through `/api/anime/lookup`.
- Runtime-fetched anime are returned to the current user session, but are not permanently written back to `animeCatalog.json` on Vercel.

Vercel serverless functions do not provide a durable writable filesystem. To persist runtime-fetched anime after deployment, add a database.

## Vercel Setup

1. Push this repo to GitHub.
2. Go to Vercel and choose **Add New Project**.
3. Import the GitHub repo.
4. Vercel should detect Vite. Confirm:
   - Build command: `npm run build`
   - Output directory: `dist`
5. Add environment variables:
   - `MAL_CLIENT_ID`
   - `MAL_CLIENT_SECRET`
   - `MAL_RATE_LIMIT_PER_SECOND=2`
6. Do **not** set `VITE_ANIMEREC_API_URL` in Vercel.
7. Deploy.

The app will call:

- `/api/catalog`
- `/api/anime/lookup?q=...`

Those routes are implemented in the `api/` folder.

## Local Development

Use two terminals:

```bash
npm run dev:api
npm run dev
```

Local development persists missing MAL lookups by writing to `src/data/animeCatalog.json`.

## Refresh The Starter Catalog

Run this locally, then commit the updated JSON:

```bash
npm run sync:mal
git add src/data/animeCatalog.json
git commit -m "Refresh MAL catalog"
git push
```

Vercel will redeploy with the refreshed catalog.

## Should You Use Vercel?

Yes, Vercel is a good fit for:

- React/Vite frontend hosting
- Serverless API routes
- Keeping MAL credentials out of the browser
- Easy GitHub-based deploys

Vercel is not enough by itself if you want runtime-fetched anime to persist permanently. Pair it with a database when that matters.

## Database Options

Best simple pairing: **Vercel + Supabase**.

Supabase gives you Postgres, a dashboard, API access, and a free tier with a 500 MB database limit. That is plenty for an anime catalog prototype.

Other good options:

- **Neon**: serverless Postgres, also has a free tier with 0.5 GB storage per project.
- **Upstash Redis**: simple key-value storage, free tier includes 256 MB data size and 500K monthly commands. Good for cached anime records, less ideal for relational querying.
- **Cloudflare Pages + D1/KV**: more integrated if you want to live inside Cloudflare. Good free static hosting, but it requires adapting the API routes to Cloudflare Functions/Workers.
- **Netlify**: good static/app hosting and serverless functions; their current free plan uses a credit-based model.

For this project, I would choose:

1. **Vercel Hobby only** for the first public demo.
2. **Vercel + Supabase** once you want persistent runtime catalog growth.
3. **Cloudflare Pages + D1** if you want a more all-in-one free stack and are comfortable changing the backend route format.

## Production Persistence Plan

When ready, create an `anime` table with roughly this shape:

```sql
create table anime (
  mal_id integer primary key,
  title_romaji text not null,
  title_english text,
  title_native text,
  image_url text,
  synopsis text,
  genres jsonb not null default '[]',
  themes jsonb not null default '[]',
  demographics jsonb not null default '[]',
  studios jsonb not null default '[]',
  year integer,
  format text,
  episodes integer,
  score numeric,
  rank integer,
  popularity integer,
  ranking_types jsonb not null default '[]',
  source text not null default 'mal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Then update `/api/anime/lookup` to:

1. Check the database.
2. If missing, fetch MAL.
3. Insert/update the database.
4. Return recommendations against the database catalog.

## Notes On Limits

Free plans change often, but current public docs show:

- Vercel Hobby includes serverless function capacity for personal projects, but no durable database by default.
- Cloudflare Pages Free has 500 builds/month and a 20,000-file site limit.
- Supabase Free includes a dedicated Postgres database with 500 MB database size.
- Neon Free includes 0.5 GB storage per project.
- Upstash Redis Free includes 256 MB data size and 500K monthly commands.

Always check the provider dashboard before launch if you expect real traffic.
