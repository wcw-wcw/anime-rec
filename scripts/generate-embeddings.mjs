import { loadEnv } from "./env.mjs";
import { readCatalog } from "./catalog-storage.mjs";
import { getDatabaseCatalog, getSql } from "./neon-db.mjs";
import { buildAnimeEmbeddingText, hashEmbeddingText } from "./utils/embedding-text.mjs";

const VECTOR_DIMENSIONS = 1536;
const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_BATCH_SIZE = 25;

await loadEnv();

const model = process.env.EMBEDDING_MODEL || DEFAULT_MODEL;
const batchSize = readPositiveInteger(process.env.EMBEDDING_BATCH_SIZE, DEFAULT_BATCH_SIZE);
const limit = readOptionalPositiveInteger(process.env.EMBEDDING_LIMIT);

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL. Add your Neon connection string to .env before generating embeddings.");
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY. Add it to .env for local/server-side embedding generation only.");
}

const sql = getSql();
await assertEmbeddingSchema(sql);

const databaseCatalog = await getDatabaseCatalog(sql);
const localCatalog = await readCatalog();
const sourceCatalog = localCatalog.length ? localCatalog : databaseCatalog;
const databaseIds = new Set(databaseCatalog.map((anime) => anime.malId ?? anime.id));
const candidates = [];

for (const anime of sourceCatalog) {
  const animeId = anime.malId ?? anime.id;
  if (!Number.isInteger(animeId) || !databaseIds.has(animeId)) {
    const title = anime?.title?.romaji || anime?.title?.english || "Untitled";
    console.warn(`Skipping "${title}" because it does not match a Neon anime row.`);
    continue;
  }

  candidates.push({ animeId, anime });
  if (limit && candidates.length >= limit) break;
}

console.log(`Preparing embeddings for ${candidates.length} anime with model ${model}.`);

let skipped = 0;
let insertedOrUpdated = 0;
let failed = 0;
let pending = [];

for (const candidate of candidates) {
  try {
    const embeddingText = buildAnimeEmbeddingText(candidate.anime);
    const embeddingTextHash = hashEmbeddingText(embeddingText);
    const [existing] = await sql.query(
      `
        select embedding_text_hash
        from animerec.anime_embeddings
        where anime_id = $1 and embedding_model = $2
        limit 1
      `,
      [candidate.animeId, model],
    );

    if (existing?.embedding_text_hash === embeddingTextHash) {
      skipped += 1;
      continue;
    }

    pending.push({
      animeId: candidate.animeId,
      title: candidate.anime.title.romaji,
      embeddingText,
      embeddingTextHash,
    });

    if (pending.length >= batchSize) {
      const result = await flushBatch(pending, { model, sql });
      insertedOrUpdated += result.insertedOrUpdated;
      failed += result.failed;
      pending = [];
      console.log(`Progress: ${insertedOrUpdated} upserted, ${skipped} skipped, ${failed} failed.`);
    }
  } catch (error) {
    failed += 1;
    console.warn(`Skipping anime ${candidate.animeId}: ${formatError(error)}`);
  }
}

if (pending.length) {
  const result = await flushBatch(pending, { model, sql });
  insertedOrUpdated += result.insertedOrUpdated;
  failed += result.failed;
}

console.log(`Done. ${insertedOrUpdated} upserted, ${skipped} skipped, ${failed} failed.`);

async function assertEmbeddingSchema(sql) {
  const [status] = await sql.query(`
    select
      exists(select 1 from pg_extension where extname = 'vector') as vector_installed,
      to_regclass('animerec.anime_embeddings') is not null as embeddings_table_exists
  `);

  if (!status?.vector_installed || !status?.embeddings_table_exists) {
    throw new Error("pgvector embedding schema is not ready. Run npm run db:migrate against your Neon dev database first.");
  }
}

async function flushBatch(records, { model, sql }) {
  try {
    const vectors = await createEmbeddings(records.map((record) => record.embeddingText), model);
    let insertedOrUpdated = 0;
    let failed = 0;

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const vector = vectors[index];

      if (!Array.isArray(vector) || vector.length !== VECTOR_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
        failed += 1;
        console.warn(`Skipping anime ${record.animeId}: embedding response had an invalid vector.`);
        continue;
      }

      try {
        await upsertEmbedding(sql, {
          animeId: record.animeId,
          model,
          embeddingTextHash: record.embeddingTextHash,
          vector,
        });
        insertedOrUpdated += 1;
      } catch (error) {
        failed += 1;
        console.warn(`Skipping anime ${record.animeId}: ${formatError(error)}`);
      }
    }

    return { insertedOrUpdated, failed };
  } catch (error) {
    for (const record of records) {
      console.warn(`Skipping anime ${record.animeId}: ${formatError(error)}`);
    }
    return { insertedOrUpdated: 0, failed: records.length };
  }
}

async function createEmbeddings(inputs, model) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: inputs }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI embeddings request failed with ${response.status}: ${body.slice(0, 300)}`);
  }

  const payload = await response.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding);
}

async function upsertEmbedding(sql, { animeId, model, embeddingTextHash, vector }) {
  await sql.query(
    `
      insert into animerec.anime_embeddings (
        anime_id,
        embedding_model,
        embedding_text_hash,
        embedding
      )
      values ($1, $2, $3, $4::vector)
      on conflict (anime_id, embedding_model) do update set
        embedding_text_hash = excluded.embedding_text_hash,
        embedding = excluded.embedding,
        updated_at = now()
      where animerec.anime_embeddings.embedding_text_hash <> excluded.embedding_text_hash
    `,
    [animeId, model, embeddingTextHash, `[${vector.join(",")}]`],
  );
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalPositiveInteger(value) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
