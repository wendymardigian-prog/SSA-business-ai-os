/**
 * Lecturas del Diseñador IA para las pantallas (F15, F17, F28).
 *
 * Todas leen con el cliente de LA PERSONA: la RLS (`designer.view`) decide qué ve. Ninguna escribe, y ninguna
 * encola renders: la lista dibuja las miniaturas en vivo con `renderPageHTML` (F48, nada de `scheduleJob`).
 *
 * La lista de Diseños trae SOLO diseños propios (`template_id IS NULL`): una generación se ve dentro de su
 * plantilla y no ensucia la lista (F15).
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { collectAssetPaths, signAssetUrls } from "./storage";
import { docVariables, parseDesignDoc, type DesignDoc } from "./doc/schema";
import { isFormatKey, type FormatKey } from "./formats";
import { parseDesignSettings, type DesignSettings } from "./settings-schema";
import type { CustomVar, DateFormat } from "./variables/catalog";
import { CUSTOM_VAR_KEY_RE } from "./variables/catalog";
import { LIST_PAGE_SIZE, originValues, pageRange, type CardRow, type ListFilters } from "./screens/list";
import { differsFromPublished } from "./screens/stale";
import { firstPageDoc, usedUploadedFonts } from "./screens/thumbs";
import type { UploadedFont } from "./fonts";
import type { DesignKind } from "./contracts";

type Db = SupabaseClient<Database>;

/** Lo que necesita una tarjeta: la fila resumida, la primera página para dibujarla y las URLs firmadas de sus archivos. */
export interface ListItem {
  card: CardRow;
  /** La primera página del documento (null si el documento guardado no se pudo leer: la tarjeta no dibuja miniatura). */
  thumbDoc: DesignDoc | null;
  customVars: CustomVar[];
  /** `designs.last_qa` (solo diseños): lo que dejó la revisión automática; alimenta el punto ámbar de la miniatura. */
  lastQa?: unknown;
}

export interface ListData {
  items: ListItem[];
  total: number;
  /** Las URLs firmadas (ruta → link) de las imágenes y fuentes de las miniaturas. */
  assetUrls: Record<string, string>;
  uploadedFonts: UploadedFont[];
  counts: { designs: number; templates: number };
}

/** `custom_vars` como viene de la base: solo las entradas con la forma esperada. */
export function parseCustomVars(raw: unknown): CustomVar[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomVar[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.key !== "string" || !CUSTOM_VAR_KEY_RE.test(v.key) || typeof v.label !== "string") continue;
    out.push({ key: v.key, label: v.label, sample: typeof v.sample === "string" ? v.sample : "", default: typeof v.default === "string" ? v.default : null });
  }
  return out;
}

/** Escapa lo que se mete en un `ilike` (los comodines y la coma del `or`). */
function likePattern(q: string): string {
  return `%${q.replace(/[%_\\,()]/g, " ").trim()}%`;
}

/** Cuántos diseños propios y cuántas plantillas hay (los contadores de las pestañas): archivados, no. */
export async function countTabs(db: Db, workspaceId: string): Promise<{ designs: number; templates: number }> {
  const [designs, templates] = await Promise.all([
    db.from("designs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("template_id", null).is("archived_at", null),
    db.from("design_templates").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("archived_at", null),
  ]);
  return { designs: designs.count ?? 0, templates: templates.count ?? 0 };
}

function asDoc(raw: Json): DesignDoc | null {
  const parsed = parseDesignDoc(raw);
  return parsed.ok ? parsed.doc : null;
}

/** La primera página, validada, sin parsear las demás (un documento cargado de HTML puede pesar mucho). */
function parseFirstPage(raw: Json): DesignDoc | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const pages = Array.isArray(record.pages) ? record.pages : [];
  const result = parseDesignDoc({ ...record, pages: pages.slice(0, 1) });
  return result.ok ? firstPageDoc(result.doc) : null;
}

function pageCountOf(raw: Json): number {
  const pages = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).pages : null;
  return Array.isArray(pages) ? pages.length : 1;
}

/** Lo que se firma de la primera página de cada tarjeta: sus imágenes y las fuentes subidas que usa. */
export async function signThumbAssets(db: Db, workspaceId: string, items: readonly ListItem[], settings: DesignSettings): Promise<Record<string, string>> {
  const paths = new Set<string>();
  const uploaded = (settings.fonts?.uploaded ?? []) as UploadedFont[];
  for (const item of items) {
    if (!item.thumbDoc) continue;
    for (const p of collectAssetPaths(item.thumbDoc, usedUploadedFonts(item.thumbDoc, 0, uploaded))) paths.add(p);
  }
  const map = await signAssetUrls(db, workspaceId, [...paths]);
  return Object.fromEntries(map);
}

/** La lista de Diseños (propios) o de Plantillas, con los filtros de la URL, de a 48. */
export async function loadList(db: Db, workspaceId: string, filters: ListFilters, settingsRaw: unknown): Promise<ListData> {
  const settings = parseDesignSettings(settingsRaw, workspaceId);
  const parsedSettings: DesignSettings = settings.ok ? settings.settings : {};
  const uploadedFonts = (parsedSettings.fonts?.uploaded ?? []) as UploadedFont[];
  const counts = await countTabs(db, workspaceId);
  const { from, to } = pageRange(filters.page);
  const origins = originValues(filters.origin);

  let items: ListItem[] = [];
  let total = 0;

  if (filters.tab === "disenos") {
    let query = db
      .from("designs")
      .select("id, name, format, origin, published, archived_at, updated_at, doc, last_qa", { count: "exact" })
      .eq("workspace_id", workspaceId)
      // Las generaciones se ven dentro de su plantilla: nunca acá.
      .is("template_id", null);
    query = filters.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
    if (filters.q) query = query.ilike("name", likePattern(filters.q));
    if (filters.format !== "all") query = query.eq("format", filters.format);
    if (origins.length) query = query.in("origin", origins);
    const { data, count, error } = await query.order("updated_at", { ascending: false }).range(from, to);
    if (error) throw new Error(`No se pudo leer la lista de diseños: ${error.message}`);
    total = count ?? 0;
    items = (data ?? []).flatMap((row) => {
      if (!isFormatKey(row.format)) return [];
      return [
        {
          card: { id: row.id, kind: "design" as const, name: row.name, format: row.format as FormatKey, origin: row.origin, pages: pageCountOf(row.doc), updatedAt: row.updated_at, archived: !!row.archived_at, published: row.published },
          thumbDoc: parseFirstPage(row.doc),
          customVars: [],
          lastQa: row.last_qa,
        },
      ];
    });
  } else {
    let query = db
      .from("design_templates")
      .select("id, name, format, origin, verify, doc_type, doc_type_label, custom_vars, archived_at, updated_at, doc", { count: "exact" })
      .eq("workspace_id", workspaceId);
    query = filters.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
    if (filters.q) query = query.ilike("name", likePattern(filters.q));
    if (filters.format !== "all") query = query.eq("format", filters.format);
    if (origins.length) query = query.in("origin", origins);
    const { data, count, error } = await query.order("updated_at", { ascending: false }).range(from, to);
    if (error) throw new Error(`No se pudo leer la lista de plantillas: ${error.message}`);
    total = count ?? 0;
    const rows = (data ?? []).filter((row) => isFormatKey(row.format));
    // Cuántas generaciones tiene cada plantilla: un conteo liviano por plantilla (índice por `template_id`).
    const generated = await Promise.all(
      rows.map(async (row) => {
        const { count: n } = await db.from("designs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("template_id", row.id);
        return n ?? 0;
      }),
    );
    items = rows.map((row, i) => {
      const full = asDoc(row.doc);
      return {
        card: {
          id: row.id,
          kind: "template" as const,
          name: row.name,
          format: row.format as FormatKey,
          origin: row.origin,
          pages: pageCountOf(row.doc),
          updatedAt: row.updated_at,
          archived: !!row.archived_at,
          variables: full ? docVariables(full).length : 0,
          generated: generated[i],
          verify: row.verify,
          docType: row.doc_type,
          docTypeLabel: row.doc_type_label,
        },
        thumbDoc: full ? firstPageDoc(full) : null,
        customVars: parseCustomVars(row.custom_vars),
      };
    });
  }

  const assetUrls = await signThumbAssets(db, workspaceId, items, parsedSettings);
  return { items, total, assetUrls, uploadedFonts, counts };
}

// ─── El editor ───────────────────────────────────────────────────────────────

/** Todo lo que el editor necesita de un diseño, una generación o una plantilla. */
export interface EditorRecord {
  kind: DesignKind;
  id: string;
  name: string;
  format: FormatKey;
  doc: DesignDoc;
  rev: number;
  origin: string;
  style: string | null;
  archived: boolean;
  updatedAt: string;
  status: string;
  // Diseños y generaciones.
  code: string | null;
  published: boolean;
  allowDownload: boolean;
  allowIndexing: boolean;
  contentPostId: string | null;
  contentNetwork: string | null;
  /** Una generación: de qué plantilla y para quién. */
  generation: { templateId: string; templateName: string | null; subjectLabel: string | null; status: string; verify: boolean; docType: "certificado" | "constancia" | "diploma" | "otro" | null; docTypeLabel: string | null } | null;
  voidInfo: { status: "valid" | "void" } | null;
  /** Publicado y con un documento distinto del de la última publicación («Hay cambios sin publicar», F48b). */
  publishedDiffers: boolean;
  /** `designs.last_qa` (solo diseños): marca con un punto ámbar la página de la tira que tiene algo para mirar (F36). */
  lastQa: unknown;
  // Plantillas.
  customVars: CustomVar[];
  dateFormat: DateFormat;
  verify: boolean;
  docType: "certificado" | "constancia" | "diploma" | "otro" | null;
  docTypeLabel: string | null;
}

const DESIGN_COLUMNS =
  "id, name, format, doc, rev, origin, style, code, published, allow_download, allow_indexing, template_id, content_post_id, content_network, subject_ref, status, archived_at, updated_at, last_qa";
const TEMPLATE_COLUMNS = "id, name, format, doc, rev, origin, style, custom_vars, date_format, verify, doc_type, doc_type_label, allow_download, archived_at, updated_at";

export type EditorLoad = { ok: true; record: EditorRecord } | { ok: false; reason: "not_found" | "invalid_doc" };

/** Carga lo que abre el editor. Con el cliente de la persona: si la RLS no lo deja ver, es "no existe". */
export async function loadEditorRecord(db: Db, workspaceId: string, kind: DesignKind, id: string): Promise<EditorLoad> {
  if (kind === "template") {
    const { data } = await db.from("design_templates").select(TEMPLATE_COLUMNS).eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    if (!data || !isFormatKey(data.format)) return { ok: false, reason: "not_found" };
    const doc = parseDesignDoc(data.doc);
    if (!doc.ok) return { ok: false, reason: "invalid_doc" };
    return {
      ok: true,
      record: {
        kind,
        id: data.id,
        name: data.name,
        format: data.format,
        doc: doc.doc,
        rev: data.rev,
        origin: data.origin,
        style: data.style,
        archived: !!data.archived_at,
        updatedAt: data.updated_at,
        status: "template",
        code: null,
        published: false,
        allowDownload: data.allow_download,
        allowIndexing: false,
        contentPostId: null,
        contentNetwork: null,
        generation: null,
        voidInfo: null,
        publishedDiffers: false,
        lastQa: null,
        customVars: parseCustomVars(data.custom_vars),
        dateFormat: data.date_format,
        verify: data.verify,
        docType: data.doc_type,
        docTypeLabel: data.doc_type_label,
      },
    };
  }
  const { data } = await db.from("designs").select(DESIGN_COLUMNS).eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  if (!data || !isFormatKey(data.format)) return { ok: false, reason: "not_found" };
  const doc = parseDesignDoc(data.doc);
  if (!doc.ok) return { ok: false, reason: "invalid_doc" };
  let generation: EditorRecord["generation"] = null;
  if (data.template_id) {
    const { data: tpl } = await db.from("design_templates").select("name, verify, doc_type, doc_type_label").eq("id", data.template_id).eq("workspace_id", workspaceId).maybeSingle();
    const ref = data.subject_ref as { label?: unknown } | null;
    generation = { templateId: data.template_id, templateName: tpl?.name ?? null, subjectLabel: typeof ref?.label === "string" ? ref.label : null, status: data.status, verify: !!tpl?.verify, docType: tpl?.doc_type ?? null, docTypeLabel: tpl?.doc_type_label ?? null };
  }
  // Un diseño publicado se compara con la copia que dejó su última publicación (no con fechas: ver `screens/stale.ts`).
  let publishedDiffers = false;
  if (data.published && !data.template_id) {
    const { data: last } = await db.from("design_versions").select("doc").eq("workspace_id", workspaceId).eq("design_id", data.id).eq("reason", "publish").order("created_at", { ascending: false }).limit(1).maybeSingle();
    publishedDiffers = differsFromPublished({ published: true, doc: data.doc, publishedDoc: last ? last.doc : null });
  }
  return {
    ok: true,
    record: {
      kind,
      id: data.id,
      name: data.name,
      format: data.format,
      doc: doc.doc,
      rev: data.rev,
      origin: data.origin,
      style: data.style,
      archived: !!data.archived_at,
      updatedAt: data.updated_at,
      status: data.status,
      code: data.code,
      published: data.published,
      allowDownload: data.allow_download,
      allowIndexing: data.allow_indexing,
      contentPostId: data.content_post_id,
      contentNetwork: data.content_network,
      generation,
      voidInfo: generation ? { status: data.status === "void" ? "void" : "valid" } : null,
      publishedDiffers,
      lastQa: (data as { last_qa?: unknown }).last_qa ?? null,
      customVars: [],
      dateFormat: "long",
      verify: false,
      docType: null,
      docTypeLabel: null,
    },
  };
}

/** Cuántas generaciones tiene una plantilla (la pestaña «Generaciones (N)»). */
export async function countGenerations(db: Db, workspaceId: string, templateId: string): Promise<number> {
  const { count } = await db.from("designs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("template_id", templateId);
  return count ?? 0;
}

/** Las firmas de los archivos del documento entero (el lienzo dibuja con las URLs firmadas de 10 minutos). */
export async function signDocAssets(db: Db, workspaceId: string, doc: DesignDoc, settings: DesignSettings): Promise<Record<string, string>> {
  const uploaded = (settings.fonts?.uploaded ?? []) as UploadedFont[];
  const families = new Set(doc.pages.flatMap((p) => p.elements.flatMap((el) => (el.type === "text" ? [el.font.family] : []))));
  const fonts = uploaded.filter((f) => families.has(f.family));
  const map = await signAssetUrls(db, workspaceId, collectAssetPaths(doc, fonts));
  return Object.fromEntries(map);
}

export { LIST_PAGE_SIZE };
