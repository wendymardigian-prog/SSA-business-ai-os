/**
 * La lista de la banca de recursos, como funciones puras: el recurso tal
 * como lo pinta la pantalla, los filtros por tipo y por etiqueta, los conteos
 * de cada chip, la paginacion y la linea de contexto de cada tipo.
 *
 * Lo comparten la pantalla de gestion y el widget del chat: si cada uno
 * contara o filtrara a su manera, los numeros de los chips dirian una cosa en
 * un lado y otra en el otro. Sin React y sin Supabase, para que Vitest lo
 * pruebe entero.
 */

import { filterAssets } from "./search";
import { ASSET_KINDS, type AssetKind, type LinkKind } from "./kind";
import { urlDomain } from "./shape";

export type TranscriptStatus = "none" | "pending" | "ready" | "failed";

/** Un recurso como lo usan la pantalla y el widget (camelCase, sin columnas internas). */
export interface BankAsset {
  id: string;
  kind: AssetKind;
  name: string;
  shortcut: string | null;
  description: string | null;
  tags: string[];
  content: string | null;
  url: string | null;
  linkKind: LinkKind | null;
  caption: string | null;
  storagePath: string | null;
  previewPath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  transcript: string | null;
  transcriptStatus: TranscriptStatus;
  transcriptError: string | null;
  agentEnabled: boolean;
  isActive: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string | null;
}

/** La fila de `response_assets` (las columnas que leen la pantalla y la bandeja). */
export interface BankAssetRow {
  id: string;
  kind: string;
  name: string;
  shortcut: string | null;
  description: string | null;
  tags: string[] | null;
  content: string | null;
  url?: string | null;
  link_kind?: string | null;
  caption?: string | null;
  storage_path: string | null;
  preview_path?: string | null;
  mime_type: string | null;
  size_bytes?: number | null;
  duration_seconds: number | null;
  transcript: string | null;
  transcript_status?: string | null;
  transcript_error?: string | null;
  agent_enabled?: boolean | null;
  is_active?: boolean | null;
  usage_count?: number | null;
  last_used_at?: string | null;
  created_at?: string | null;
}

export function toBankAsset(row: BankAssetRow): BankAsset {
  return {
    id: row.id,
    kind: row.kind as AssetKind,
    name: row.name,
    shortcut: row.shortcut,
    description: row.description,
    tags: row.tags ?? [],
    content: row.content,
    url: row.url ?? null,
    linkKind: (row.link_kind ?? null) as LinkKind | null,
    caption: row.caption ?? null,
    storagePath: row.storage_path,
    previewPath: row.preview_path ?? null,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes ?? null,
    durationSeconds: row.duration_seconds,
    transcript: row.transcript,
    transcriptStatus: (row.transcript_status ?? "none") as TranscriptStatus,
    transcriptError: row.transcript_error ?? null,
    agentEnabled: row.agent_enabled ?? false,
    isActive: row.is_active ?? true,
    usageCount: row.usage_count ?? 0,
    lastUsedAt: row.last_used_at ?? null,
    createdAt: row.created_at ?? null,
  };
}

// ── Filtros ────────────────────────────────────────────────────────────────

export type KindFilter = "all" | AssetKind;

export interface AssetFilters {
  kind: KindFilter;
  /** Combinadas con Y: dos etiquetas = los recursos que tienen las dos. */
  tags: string[];
  query: string;
}

export const NO_FILTERS: AssetFilters = { kind: "all", tags: [], query: "" };

export function hasActiveFilters(filters: AssetFilters): boolean {
  return filters.kind !== "all" || filters.tags.length > 0 || filters.query.trim().length > 0;
}

const tagKey = (tag: string) => tag.trim().toLowerCase();

function hasAllTags(asset: Pick<BankAsset, "tags">, tags: string[]): boolean {
  if (tags.length === 0) return true;
  const own = new Set(asset.tags.map(tagKey));
  return tags.every((t) => own.has(tagKey(t)));
}

type Filterable = Pick<
  BankAsset,
  "id" | "kind" | "name" | "shortcut" | "content" | "transcript" | "tags" | "description" | "url" | "usageCount" | "lastUsedAt" | "createdAt"
>;

/** Aplica los tres filtros, con el orden de la busqueda (relevancia, despues uso). */
export function applyFilters<T extends Filterable>(assets: T[], filters: AssetFilters): T[] {
  const byKindAndTags = assets.filter(
    (a) => (filters.kind === "all" || a.kind === filters.kind) && hasAllTags(a, filters.tags),
  );
  return filterAssets(byKindAndTags, filters.query);
}

/**
 * Cuantos hay de cada tipo, con los OTROS filtros aplicados (etiquetas y
 * busqueda): el numero de un chip dice cuantos verias si lo tocaras. Un tipo
 * con cero esta en el mapa igual: si desapareciera, nadie descubriria que
 * ese tipo existe.
 */
export function kindCounts<T extends Filterable>(assets: T[], filters: AssetFilters): Record<KindFilter, number> {
  const base = applyFilters(assets, { ...filters, kind: "all" });
  const counts = { all: base.length } as Record<KindFilter, number>;
  for (const kind of ASSET_KINDS) counts[kind] = 0;
  for (const asset of base) counts[asset.kind] += 1;
  return counts;
}

export interface TagCount {
  tag: string;
  count: number;
  selected: boolean;
}

/**
 * Las etiquetas que existen de verdad, con cuantos recursos las tienen (con
 * el tipo y la busqueda aplicados). Sin distinguir mayusculas: "Precios" y
 * "precios" son la misma; se muestra la grafia mas usada. Una seleccionada
 * se muestra siempre, aunque quede en cero, para poder sacarla.
 */
export function tagCounts<T extends Filterable>(assets: T[], filters: AssetFilters): TagCount[] {
  const base = applyFilters(assets, { ...filters, tags: [] });
  const selected = new Set(filters.tags.map(tagKey));
  const byKey = new Map<string, { spellings: Map<string, number>; count: number }>();

  for (const asset of base) {
    if (!hasAllTags(asset, filters.tags)) continue;
    const seen = new Set<string>();
    for (const tag of asset.tags) {
      const key = tagKey(tag);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = byKey.get(key) ?? { spellings: new Map(), count: 0 };
      entry.count += 1;
      entry.spellings.set(tag.trim(), (entry.spellings.get(tag.trim()) ?? 0) + 1);
      byKey.set(key, entry);
    }
  }

  for (const tag of filters.tags) {
    const key = tagKey(tag);
    if (!byKey.has(key)) byKey.set(key, { spellings: new Map([[tag.trim(), 1]]), count: 0 });
  }

  return [...byKey.entries()]
    .map(([key, entry]) => {
      const spelling = [...entry.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))[0][0];
      return { tag: spelling, count: entry.count, selected: selected.has(key) };
    })
    .sort((a, b) => Number(b.selected) - Number(a.selected) || b.count - a.count || a.tag.localeCompare(b.tag, "es"));
}

/** Prende o apaga una etiqueta en el filtro, sin distinguir mayusculas. */
export function toggleTag(tags: string[], tag: string): string[] {
  const key = tagKey(tag);
  return tags.some((t) => tagKey(t) === key) ? tags.filter((t) => tagKey(t) !== key) : [...tags, tag];
}

// ── Paginacion ─────────────────────────────────────────────────────────────

export const PAGE_SIZE = 25;

export interface Page<T> {
  items: T[];
  /** 1-based, ya acotada al rango valido. */
  page: number;
  totalPages: number;
  total: number;
}

export function paginate<T>(items: T[], page: number, pageSize = PAGE_SIZE): Page<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, totalPages, total: items.length };
}

// ── Lo que se muestra de cada recurso ──────────────────────────────────────

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * La linea de contexto de cada tipo, debajo del nombre: el contenido de un
 * texto, la transcripcion de un audio o un video (o su estado), la
 * descripcion de una imagen o un archivo, el dominio de un enlace.
 */
export function contextLine(
  asset: Pick<BankAsset, "kind" | "content" | "transcript" | "transcriptStatus" | "description" | "url">,
  max = 120,
): string {
  switch (asset.kind) {
    case "text":
      return clip(asset.content ?? "", max);
    case "audio":
    case "video": {
      if (asset.transcriptStatus === "ready" && asset.transcript) return clip(asset.transcript, max);
      const status = transcriptStatusLabel(asset.kind, asset.transcriptStatus);
      return asset.description ? clip(`${status} · ${asset.description}`, max) : status;
    }
    case "image":
    case "file":
      return clip(asset.description ?? "", max);
    case "link":
      return [urlDomain(asset.url), asset.description ? clip(asset.description, max) : ""].filter(Boolean).join(" · ");
  }
}

/** El estado de la transcripcion dicho en castellano. */
export function transcriptStatusLabel(kind: AssetKind, status: TranscriptStatus): string {
  switch (status) {
    case "ready":
      return "Transcripción lista";
    case "pending":
      return "Transcribiendo…";
    case "failed":
      return "No se pudo transcribir";
    case "none":
      // Un video en 'none' es un video sin voz (uno con voz siempre se encola).
      return kind === "video" ? "Sin voz" : "Esperando transcripción";
  }
}

/**
 * Si el asistente lo puede usar, segun su transcripcion (la misma regla que
 * `setAssetAgentEnabled` y la herramienta del agente): un audio necesita la
 * transcripcion lista; un video, lista o ninguna (sin voz).
 */
export function agentUsable(asset: Pick<BankAsset, "kind" | "transcriptStatus">): boolean {
  if (asset.kind === "audio") return asset.transcriptStatus === "ready";
  if (asset.kind === "video") return asset.transcriptStatus === "ready" || asset.transcriptStatus === "none";
  return true;
}
