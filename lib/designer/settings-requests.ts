/**
 * Lo que hacen las acciones de Ajustes del Diseñador IA (F11 y F37), sin la sesión:
 * estilos propios y fuentes. Piden `designer.manage` (lo chequean las acciones).
 *
 * Reciben el cliente de servicio y el negocio de la SESIÓN, y escriben siempre
 * filtrando por él. Los archivos se validan por sus BYTES (nunca por la extensión
 * ni por lo que declara el navegador). Una fuente de Google se valida pidiéndola a
 * Google desde el servidor (200 = existe). Las fuentes subidas van a
 * `design-assets/<negocio>/fonts/`.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { openAiRun, type AiRunHandle } from "@/lib/ai/run";
import { withinWorkspaceBudget, type BudgetDecision } from "@/lib/ai/workspace-budget";
import type { Database } from "@/lib/types/database";
import type { ActionResult } from "./contracts";
import { allowedFontsFor, loadWorkspaceContext } from "./ai/context";
import { budgetBlockMessage } from "./ai/cost";
import { makeMeasure, type MeasureFn } from "./ai/measure";
import { NO_AI_MESSAGE, aiSdkDesignerGenerate, resolveDesignerModel, type DesignerGenerate } from "./ai/provider";
import { extractStyleFromImages, MAX_STYLE_IMAGE_BYTES, MAX_STYLE_IMAGES, MIN_STYLE_IMAGES, normalizeExtractedStyle } from "./ai/style-extract";
import { parseDesignDoc } from "./doc/schema";
import { checkFontUpload, curatedFont, FONT_FAMILY_RE, googleFamilyCheckUrl, type FontFileFormat } from "./fonts";
import { updateDesignSettings } from "./settings-store";
import { UPLOADED_FONT_PATH_RE, type UploadedFontEntry } from "./settings-schema";
import type { DesignStyle } from "./styles";
import { checkImageUpload, DESIGN_ASSETS_BUCKET, fontAssetPath, pathBelongsTo } from "./storage";

type Db = SupabaseClient<Database>;

interface Who {
  workspaceId: string;
  userId: string;
}

const fail = (error: string) => ({ ok: false as const, error });

async function audit(db: Db, who: Who, change: string, detail: Record<string, string>): Promise<void> {
  await logAudit({ supabase: db, workspaceId: who.workspaceId, entityType: "workspace", entityId: who.workspaceId, action: "update", metadata: { kind: "design_settings", change, ...detail }, performedBy: who.userId });
}

// ─── Estilos propios (F37) ──────────────────────────────────────────────────

export interface ExtractDeps {
  /** El modelo simulado de los tests. Sin esto, el del negocio. */
  model?: { generate: DesignerGenerate; provider: string; modelId: string } | null;
  budget?: (db: Db, workspaceId: string, now: Date, opts: { model: { provider: string; model: string } | null }) => Promise<BudgetDecision>;
  openRun?: typeof openAiRun;
  /** Para dibujar un diseño existente como imagen (servicio de render simulado en los tests). */
  measure?: (workspaceId: string, uploadedFonts: Parameters<typeof makeMeasure>[0]["uploadedFonts"]) => MeasureFn;
  now?: () => Date;
}

export interface ExtractRequest extends Who {
  /** Las imágenes subidas por la persona (los bytes, no se guardan). */
  files: { bytes: Uint8Array; name: string }[];
  /** Diseños propios elegidos como referencia: se dibuja su primera página. */
  designIds: string[];
  name?: string;
}

/** «+ Crear desde mis piezas»: la IA extrae un estilo de 3 a 5 imágenes. No se guarda; la persona lo revisa. */
export async function extractStyleRequest(db: Db, input: ExtractRequest, deps: ExtractDeps = {}): Promise<ActionResult<{ style: DesignStyle; corrections: string[] }>> {
  const now = deps.now ?? (() => new Date());
  const total = input.files.length + input.designIds.length;
  if (total < MIN_STYLE_IMAGES || total > MAX_STYLE_IMAGES) return fail(`Elegí entre ${MIN_STYLE_IMAGES} y ${MAX_STYLE_IMAGES} piezas (imágenes o diseños tuyos).`);

  const workspace = await loadWorkspaceContext(db, input.workspaceId);
  if (!workspace) return fail("No pude leer los datos del negocio. Probá de nuevo.");

  const images: { bytes: Uint8Array; mediaType: string; name: string }[] = [];
  for (const file of input.files) {
    if (file.bytes.length > MAX_STYLE_IMAGE_BYTES) return fail(`«${file.name}» pesa más de 8 MB.`);
    const check = checkImageUpload(file.bytes);
    if (!check.ok) return fail(`«${file.name}»: ${check.error}`);
    images.push({ bytes: file.bytes, mediaType: check.mime, name: file.name });
  }

  // Los diseños elegidos se dibujan con el servicio de render (una sola página, la primera).
  for (const id of input.designIds) {
    const { data } = await db.from("designs").select("id, name, doc").eq("id", id).eq("workspace_id", input.workspaceId).maybeSingle();
    if (!data) return fail("Uno de los diseños elegidos ya no existe.");
    const parsed = parseDesignDoc(data.doc);
    if (!parsed.ok) return fail(`El diseño «${data.name}» no se puede leer.`);
    const measure = (deps.measure ?? ((ws, fonts) => makeMeasure({ db, workspaceId: ws, uploadedFonts: fonts })))(input.workspaceId, workspace.uploadedFonts);
    const first = { ...parsed.doc, pages: [parsed.doc.pages[0]] };
    const rendered = await measure(first);
    if (rendered.status !== "ok" || !rendered.images[0]) return fail("No pude dibujar tus diseños (falta conectar el servicio de render). Subí imágenes de tus piezas.");
    images.push({ bytes: rendered.images[0], mediaType: "image/png", name: data.name });
  }

  let model = deps.model ?? null;
  if (!model) {
    const resolved = await resolveDesignerModel(input.workspaceId, db);
    if (!resolved.ok) return fail(resolved.problem === "no_provider" ? NO_AI_MESSAGE : resolved.message);
    model = { generate: aiSdkDesignerGenerate(resolved.model), provider: resolved.provider, modelId: resolved.modelId };
  }

  const blocked = budgetBlockMessage(await (deps.budget ?? withinWorkspaceBudget)(db, input.workspaceId, now(), { model: { provider: model.provider, model: model.modelId } }));
  if (blocked) return fail(blocked);

  const run: AiRunHandle = await (deps.openRun ?? openAiRun)(db, { workspaceId: input.workspaceId, source: "designer", trigger: "manual", provider: model.provider, model: model.modelId });
  try {
    const allowedFonts = allowedFontsFor(workspace, { key: "auto", name: "", palette: { bg: "#ffffff", text: "#111111", accent: "#4f46e5" }, fonts: { title: "Inter", body: "Inter" }, density: {}, rules: "" });
    const result = await extractStyleFromImages({ images, allowedFonts, name: input.name }, { generate: model.generate, onUsage: (u) => run.addStepUsage(u) });
    await run.close(result.ok ? { status: "responded", statusDetail: "style_extract" } : { status: "error", statusDetail: "style_extract_invalid", error: result.error });
    return result.ok ? { ok: true, data: { style: result.style, corrections: result.corrections } } : fail(result.error);
  } catch (error) {
    console.error("[designer-settings] falló la extracción del estilo:", error instanceof Error ? error.name : "error");
    await run.close({ status: "error", statusDetail: "provider_failed", error: "La IA no respondió" });
    return fail("La IA no respondió. Probá de nuevo en un momento.");
  }
}

/** Guarda un estilo propio (nuevo o editado) con nombre. Lo deja válido: fuentes de la lista, colores y densidad acotados. */
export async function saveStyleRequest(db: Db, who: Who, style: DesignStyle): Promise<ActionResult<{ style: DesignStyle }>> {
  const workspace = await loadWorkspaceContext(db, who.workspaceId);
  if (!workspace) return fail("No pude leer los datos del negocio. Probá de nuevo.");
  if (!style || typeof style !== "object" || !style.palette || !style.fonts) return fail("El estilo no es válido.");
  if (!String(style.name ?? "").trim()) return fail("El estilo necesita un nombre.");
  const allowedFonts = allowedFontsFor(workspace, { ...style, palette: style.palette, fonts: { title: "Inter", body: "Inter" } });
  const normalized = normalizeExtractedStyle(
    { ...style, rules: String(style.rules ?? ""), density: style.density ?? {} },
    { allowedFonts, key: style.key, name: style.name },
  );
  if (!normalized.ok) return fail(normalized.error);
  const saved = normalized.style;

  const result = await updateDesignSettings(db, who.workspaceId, (current) => {
    const others = current.styles.filter((s) => s.key !== saved.key);
    if (others.some((s) => s.name.trim().toLowerCase() === saved.name.trim().toLowerCase() && !s.archived && !saved.archived)) return { ok: false, error: "Ya tenés un estilo con ese nombre." };
    if (others.length >= 30) return { ok: false, error: "Llegaste al máximo de 30 estilos propios. Archivá alguno." };
    const index = current.styles.findIndex((s) => s.key === saved.key);
    const styles = index >= 0 ? current.styles.map((s, i) => (i === index ? saved : s)) : [...current.styles, saved];
    return { ok: true, next: { ...current, styles } };
  });
  if (!result.ok) return fail(result.error);
  await audit(db, who, "style_saved", { style: saved.name });
  return { ok: true, data: { style: saved } };
}

/** Archivar un estilo propio: deja de ofrecerse, pero los diseños que lo usaron no cambian. Se puede restaurar guardándolo de nuevo. */
export async function archiveStyleRequest(db: Db, who: Who, key: string, archived = true): Promise<ActionResult> {
  let name = "";
  const result = await updateDesignSettings(db, who.workspaceId, (current) => {
    const style = current.styles.find((s) => s.key === key);
    if (!style) return { ok: false, error: "No encontré ese estilo." };
    name = style.name;
    return { ok: true, next: { ...current, styles: current.styles.map((s) => (s.key === key ? { ...s, archived } : s)) } };
  });
  if (!result.ok) return fail(result.error);
  await audit(db, who, archived ? "style_archived" : "style_restored", { style: name });
  return { ok: true, data: undefined };
}

// ─── Fuentes (F11) ──────────────────────────────────────────────────────────

const titleCaseIfLower = (name: string) => (name === name.toLowerCase() ? name.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : name);

/** «Otra fuente de Google»: la valida pidiéndola a Google desde el servidor (200 = existe) y la agrega. */
export async function addGoogleFontRequest(db: Db, who: Who, rawFamily: string, fetchImpl: typeof fetch = fetch): Promise<ActionResult<{ family: string }>> {
  const typed = titleCaseIfLower(String(rawFamily ?? "").trim().replace(/\s+/g, " "));
  if (!typed || !FONT_FAMILY_RE.test(typed)) return fail("Escribí el nombre de la fuente como figura en Google Fonts (solo letras, números y espacios).");
  const known = curatedFont(typed);
  if (known) return { ok: true, data: { family: known.family } };
  const url = googleFamilyCheckUrl(typed);
  if (!url) return fail("Escribí el nombre de la fuente como figura en Google Fonts.");

  let status: number;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000), headers: { "user-agent": "Mozilla/5.0" } });
    status = response.status;
  } catch {
    return fail("No pude comprobar la fuente con Google ahora. Probá de nuevo en un momento.");
  }
  if (status === 400 || status === 404) return fail(`No encontré «${typed}» en Google Fonts. Revisá cómo se escribe.`);
  if (status !== 200) return fail("No pude comprobar la fuente con Google ahora. Probá de nuevo en un momento.");

  const result = await updateDesignSettings(db, who.workspaceId, (current) => {
    if (current.fonts.google.some((f) => f.toLowerCase() === typed.toLowerCase())) return { ok: true, next: current };
    if (current.fonts.google.length >= 50) return { ok: false, error: "Llegaste al máximo de 50 fuentes de Google. Quitá alguna." };
    return { ok: true, next: { ...current, fonts: { ...current.fonts, google: [...current.fonts.google, typed] } } };
  });
  if (!result.ok) return fail(result.error);
  await audit(db, who, "font_added", { font: typed });
  return { ok: true, data: { family: typed } };
}

const FONT_CONTENT_TYPE: Record<FontFileFormat, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };

export interface UploadFontRequest extends Who {
  bytes: Uint8Array;
  fileName: string;
  /** El nombre de la familia; sin él se usa el del archivo. */
  family?: string;
  weight?: number;
  italic?: boolean;
}

export function familyFromFileName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? "").replace(/\.[A-Za-z0-9]+$/, "");
  const spaced = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced.replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, 60);
}

/** «Subir mi fuente»: .woff2, .woff, .ttf u .otf de hasta 2 MB, validada por sus bytes. */
export async function uploadFontRequest(db: Db, input: UploadFontRequest): Promise<ActionResult<{ family: string; weight: number }>> {
  const check = checkFontUpload(input.bytes);
  if (!check.ok) return fail(check.error);
  const family = (input.family ?? "").trim().replace(/\s+/g, " ") || familyFromFileName(input.fileName);
  if (!family || !FONT_FAMILY_RE.test(family)) return fail("Escribí un nombre para la fuente (solo letras, números y espacios).");
  const weight = input.weight ?? 400;
  if (!Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100 !== 0) return fail("El peso va de 100 a 900, de a 100.");
  const style = input.italic ? "italic" : "normal";

  const path = fontAssetPath(input.workspaceId, check.format);
  const { error: uploadError } = await db.storage.from(DESIGN_ASSETS_BUCKET).upload(path, input.bytes, { contentType: FONT_CONTENT_TYPE[check.format], upsert: false });
  if (uploadError) {
    console.error("[designer-settings] no pude subir la fuente:", uploadError.message);
    return fail("No se pudo subir la fuente. Probá de nuevo.");
  }

  let replaced: string[] = [];
  const result = await updateDesignSettings(db, input.workspaceId, (current) => {
    const entry: UploadedFontEntry = { family, weight, style, path, format: check.format };
    const same = (f: UploadedFontEntry) => f.family.toLowerCase() === family.toLowerCase() && f.weight === weight && f.style === style;
    replaced = current.fonts.uploaded.filter(same).map((f) => f.path);
    const rest = current.fonts.uploaded.filter((f) => !same(f));
    if (rest.length >= 30) return { ok: false, error: "Llegaste al máximo de 30 fuentes subidas. Quitá alguna." };
    return { ok: true, next: { ...current, fonts: { ...current.fonts, uploaded: [...rest, entry] } } };
  });
  if (!result.ok) {
    // No quedó registrada: se borra el archivo para no dejar basura en el bucket.
    await db.storage.from(DESIGN_ASSETS_BUCKET).remove([path]);
    return fail(result.error);
  }
  if (replaced.length) await db.storage.from(DESIGN_ASSETS_BUCKET).remove(replaced);
  await audit(db, input, "font_uploaded", { font: family });
  return { ok: true, data: { family, weight } };
}

/** Quita una fuente de Google o una subida (con su archivo). Los diseños que la usan pasan a la fuente de reemplazo del navegador. */
export async function removeFontRequest(db: Db, who: Who, input: { family: string; path?: string }): Promise<ActionResult> {
  const family = String(input.family ?? "").trim();
  if (!family) return fail("Falta decir qué fuente quitar.");
  let removedPaths: string[] = [];
  let found = false;
  const result = await updateDesignSettings(db, who.workspaceId, (current) => {
    const google = current.fonts.google.filter((f) => f.toLowerCase() !== family.toLowerCase() || !!input.path);
    const isUploadMatch = (f: UploadedFontEntry) => (input.path ? f.path === input.path : f.family.toLowerCase() === family.toLowerCase());
    const removed = current.fonts.uploaded.filter(isUploadMatch);
    removedPaths = removed.map((f) => f.path);
    found = google.length !== current.fonts.google.length || removed.length > 0;
    if (!found) return { ok: false, error: "No encontré esa fuente." };
    return { ok: true, next: { ...current, fonts: { google, uploaded: current.fonts.uploaded.filter((f) => !isUploadMatch(f)) } } };
  });
  if (!result.ok) return fail(result.error);
  const safe = removedPaths.filter((p) => pathBelongsTo(p, who.workspaceId) && UPLOADED_FONT_PATH_RE.test(p));
  if (safe.length) await db.storage.from(DESIGN_ASSETS_BUCKET).remove(safe);
  await audit(db, who, "font_removed", { font: family });
  return { ok: true, data: undefined };
}
