create extension if not exists vector;

create schema if not exists animerec;

create table if not exists animerec.anime_embeddings (
  anime_id integer not null references animerec.anime (mal_id) on delete cascade,
  embedding_model text not null,
  embedding_text_hash text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint anime_embeddings_primary unique (anime_id, embedding_model),
  constraint anime_embeddings_model_hash_unique unique (anime_id, embedding_model, embedding_text_hash)
);

create index if not exists anime_embeddings_model_idx
  on animerec.anime_embeddings (embedding_model);
