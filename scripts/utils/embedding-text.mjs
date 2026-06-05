import { createHash } from "node:crypto";

const EMPTY_VALUE = "None";

export function buildAnimeEmbeddingText(anime) {
  const title = anime?.title ?? {};
  // Keep this line-based format stable; hashes depend on the final string.
  const lines = [
    field("Romaji title", cleanText(title.romaji)),
    field("Native title", cleanText(title.native)),
    field("Synopsis", cleanText(anime?.synopsis)),
    field("Genres", cleanList(anime?.genres).join(", ")),
    field("Themes", cleanList(anime?.themes).join(", ")),
    field("Demographics", cleanList(anime?.demographics).join(", ")),
    field("Studios", cleanList(anime?.studios).join(", ")),
    field("Format", cleanText(anime?.format)),
    field("Year", cleanNumber(anime?.year)),
  ];

  return lines.join("\n");
}

export function hashEmbeddingText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function field(label, value) {
  return `${label}: ${value || EMPTY_VALUE}`;
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanText).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function cleanNumber(value) {
  return Number.isFinite(value) ? String(value) : "";
}
