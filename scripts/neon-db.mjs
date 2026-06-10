import { neon } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getSql() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
  return neon(process.env.DATABASE_URL);
}

export async function applyMigrationFile(path, sql = getSql()) {
  const contents = await readFile(path, "utf8");
  for (const statement of splitSqlStatements(contents)) {
    await sql.query(statement);
  }
}

export async function ensureAnimeEmbeddingSchema(sql = getSql()) {
  const migrationPath = fileURLToPath(new URL("../database/migrations/001_pgvector_anime_embeddings.sql", import.meta.url));
  await applyMigrationFile(migrationPath, sql);
}

function splitSqlStatements(contents) {
  return contents
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function ensureAnimeTable(sql = getSql()) {
  await sql`create schema if not exists animerec`;
  await sql`
    create table if not exists animerec.anime (
      mal_id integer primary key,
      title_romaji text not null,
      title_english text,
      title_native text,
      image_url text not null default '',
      synopsis text not null default '',
      genres jsonb not null default '[]'::jsonb,
      themes jsonb not null default '[]'::jsonb,
      demographics jsonb not null default '[]'::jsonb,
      studios jsonb not null default '[]'::jsonb,
      year integer,
      format text not null default 'TV',
      episodes integer,
      score numeric,
      rank integer,
      popularity integer,
      ranking_types jsonb not null default '[]'::jsonb,
      source text not null default 'mal',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists anime_rank_idx on animerec.anime (rank nulls last)`;
  await sql`create index if not exists anime_popularity_idx on animerec.anime (popularity nulls last)`;
}

export async function getDatabaseCatalog(sql = getSql()) {
  const rows = await sql`
    select
      mal_id,
      title_romaji,
      title_english,
      title_native,
      image_url,
      synopsis,
      genres,
      themes,
      demographics,
      studios,
      year,
      format,
      episodes,
      score,
      rank,
      popularity,
      ranking_types,
      source
    from animerec.anime
    order by rank nulls last, popularity nulls last, mal_id
  `;
  return rows.map(fromDatabaseRow);
}

export async function getVectorSimilarAnime({ animeId, limit = 20, model = "text-embedding-3-small", sql = getSql() }) {
  const [embeddingStatus] = await sql.query(
    `
      select count(*)::int as embedding_count
      from animerec.anime_embeddings
      where embedding_model = $1
    `,
    [model],
  );

  if (!embeddingStatus?.embedding_count) {
    return { status: "empty", source: null, similar: [] };
  }

  const [sourceRow] = await sql.query(
    `
      select
        a.mal_id,
        a.title_romaji,
        a.title_english,
        a.title_native
      from animerec.anime_embeddings ae
      join animerec.anime a on a.mal_id = ae.anime_id
      where ae.anime_id = $1 and ae.embedding_model = $2
      limit 1
    `,
    [animeId, model],
  );

  if (!sourceRow) {
    return { status: "missing_source_embedding", source: null, similar: [] };
  }

  const rows = await sql.query(
    `
      -- Cosine distance is provided by pgvector's <=> operator; lower is nearer.
      with source_embedding as (
        select embedding
        from animerec.anime_embeddings
        where anime_id = $1 and embedding_model = $2
        limit 1
      )
      select
        a.mal_id,
        a.title_romaji,
        a.title_english,
        a.title_native,
        a.image_url,
        a.synopsis,
        a.genres,
        a.themes,
        a.demographics,
        a.studios,
        a.year,
        a.format,
        a.episodes,
        a.score,
        a.rank,
        a.popularity,
        a.ranking_types,
        a.source,
        (ae.embedding <=> se.embedding)::float as vector_distance
      from animerec.anime_embeddings ae
      join source_embedding se on true
      join animerec.anime a on a.mal_id = ae.anime_id
      where ae.embedding_model = $2
        and ae.anime_id <> $1
      order by vector_distance asc, a.rank nulls last, a.popularity nulls last, a.mal_id
      limit $3
    `,
    [animeId, model, limit],
  );

  return {
    status: "ok",
    source: {
      id: sourceRow.mal_id,
      malId: sourceRow.mal_id,
      title: {
        romaji: sourceRow.title_romaji,
        english: sourceRow.title_english ?? undefined,
        native: sourceRow.title_native ?? undefined,
      },
    },
    similar: rows.map((row) => ({
      anime: fromDatabaseRow(row),
      vectorDistance: Number(row.vector_distance),
      vectorSimilarity: normalizeVectorSimilarity(Number(row.vector_distance)),
    })),
  };
}

export async function upsertAnimeCatalog(anime, sql = getSql()) {
  if (!anime.length) return;
  await ensureAnimeTable(sql);
  for (let offset = 0; offset < anime.length; offset += 100) {
    await upsertAnimeBatch(anime.slice(offset, offset + 100), sql);
  }
}

async function upsertAnimeBatch(anime, sql) {
  const records = anime.map(toDatabaseRecord);
  await sql`
    insert into animerec.anime (
      mal_id,
      title_romaji,
      title_english,
      title_native,
      image_url,
      synopsis,
      genres,
      themes,
      demographics,
      studios,
      year,
      format,
      episodes,
      score,
      rank,
      popularity,
      ranking_types,
      source
    )
    select
      record.mal_id,
      record.title_romaji,
      record.title_english,
      record.title_native,
      record.image_url,
      record.synopsis,
      record.genres,
      record.themes,
      record.demographics,
      record.studios,
      record.year,
      record.format,
      record.episodes,
      record.score,
      record.rank,
      record.popularity,
      record.ranking_types,
      record.source
    from jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as record(
      mal_id integer,
      title_romaji text,
      title_english text,
      title_native text,
      image_url text,
      synopsis text,
      genres jsonb,
      themes jsonb,
      demographics jsonb,
      studios jsonb,
      year integer,
      format text,
      episodes integer,
      score numeric,
      rank integer,
      popularity integer,
      ranking_types jsonb,
      source text
    )
    on conflict (mal_id) do update set
      title_romaji = excluded.title_romaji,
      title_english = excluded.title_english,
      title_native = excluded.title_native,
      image_url = excluded.image_url,
      synopsis = excluded.synopsis,
      genres = excluded.genres,
      themes = excluded.themes,
      demographics = excluded.demographics,
      studios = excluded.studios,
      year = excluded.year,
      format = excluded.format,
      episodes = excluded.episodes,
      score = excluded.score,
      rank = excluded.rank,
      popularity = excluded.popularity,
      ranking_types = excluded.ranking_types,
      source = excluded.source,
      updated_at = now()
  `;
}

function toDatabaseRecord(anime) {
  return {
    mal_id: anime.malId ?? anime.id,
    title_romaji: anime.title.romaji,
    title_english: anime.title.english ?? null,
    title_native: anime.title.native ?? null,
    image_url: anime.imageUrl ?? "",
    synopsis: anime.synopsis ?? "",
    genres: anime.genres ?? [],
    themes: anime.themes ?? [],
    demographics: anime.demographics ?? [],
    studios: anime.studios ?? [],
    year: anime.year ?? null,
    format: anime.format ?? "TV",
    episodes: anime.episodes ?? null,
    score: anime.score ?? null,
    rank: anime.rank ?? null,
    popularity: anime.popularity ?? null,
    ranking_types: anime.rankingTypes ?? [],
    source: anime.source ?? "mal",
  };
}

function fromDatabaseRow(row) {
  return {
    id: row.mal_id,
    malId: row.mal_id,
    title: {
      romaji: row.title_romaji,
      english: row.title_english ?? undefined,
      native: row.title_native ?? undefined,
    },
    imageUrl: row.image_url,
    synopsis: row.synopsis,
    genres: row.genres ?? [],
    themes: row.themes ?? [],
    demographics: row.demographics ?? [],
    studios: row.studios ?? [],
    year: row.year ?? undefined,
    format: row.format,
    episodes: row.episodes ?? undefined,
    score: row.score === null ? undefined : Number(row.score),
    rank: row.rank ?? undefined,
    popularity: row.popularity ?? undefined,
    rankingTypes: row.ranking_types ?? [],
    source: row.source,
  };
}

function normalizeVectorSimilarity(distance) {
  // pgvector cosine distance is 0 for identical vectors and approaches 1 as similarity falls.
  if (!Number.isFinite(distance)) return 0;
  return Math.max(0, Math.min(100, (1 - distance) * 100));
}
