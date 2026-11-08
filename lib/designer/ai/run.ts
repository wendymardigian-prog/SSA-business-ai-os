/**
 * El motor de la IA del Diseñador (F32 a F36): de un pedido a un documento.
 *
 * No toca la base ni el Storage: recibe todo por parámetro y habla con el
 * modelo y con el servicio de render solo por los PUERTOS que le pasan
 * (`generate`, `measure`). Los tests le pasan dobles; el job le pasa el modelo
 * real del negocio. Lo que escribe en la base (versión, mensajes, costos) lo
 * hace quien lo llama, DESPUÉS de fusionar con lo que la persona tocó.
 *
 * Qué hace, en orden:
 *   1. arma el prompt (sistema fijo + mensaje con los datos) y llama al modelo;
 *   2. valida la salida con Zod: un documento (primera versión) o un parche
 *      (cambios, estilo, propuestas); aplica el alcance y normaliza (ids,
 *      fuentes permitidas, rangos, imágenes) y valida el documento resultante;
 *   3. si algo no valida, reintenta UNA vez con el motivo; si vuelve a fallar:
 *      «No pude aplicar ese cambio» y no se toca nada;
 *   4. primera versión: la primera foto adjunta va de fondo de la portada con
 *      una capa de color que alcanza el contraste (F33);
 *   5. estilo: los textos tienen que quedar idénticos (F35);
 *   6. revisión automática: mide, corrige lo del contraste sin la IA y hace
 *      como máximo dos pasadas de corrección con la IA (F36).
 *
 * Un fallo del PROVEEDOR (red, 429, 5xx) no se atrapa acá: se lanza para que el
 * job lo reagende. Solo la pasada de corrección es opcional y no tumba lo que
 * ya estaba hecho.
 *
 * Solo servidor.
 */

import type { UsageLike } from "@/lib/ai/run";
import type { ContentAiContext } from "../contracts";
import { parseDesignDoc, type DesignDoc } from "../doc/schema";
import type { FormatKey } from "../formats";
import type { DesignStyle } from "../styles";
import type { VariableGroup } from "../variables/catalog";
import { AssetAliases } from "./assets";
import { applyCoverImage, ensureOverlays } from "./cover";
import { sanitizeAiDoc } from "./doc-sanitize";
import type { MeasureFn } from "./measure";
import { normalizeDoc, type NormalizeContext } from "./normalize";
import { changedPageIndexes } from "./patch";
import { buildSystemPrompt, buildUserPrompt, type DesignerMode, type PromptBrand, type PromptInput } from "./prompt";
import type { DesignerGenerate, DesignerImage } from "./provider";
import { runQaLoop, type CorrectionRequest, type CorrectionResult } from "./qa-loop";
import { qaProblemsForPrompt, qaWarnings, type QaIssue } from "./qa";
import { applyScoped, type PatchScope } from "./scope";
import { aiDocOutputSchema, aiPatchOutputSchema, parseAiDocOutput, parseAiPatchOutput, type DesignPatch, type DocumentKind } from "./schema";

export const COULD_NOT_APPLY = "No pude aplicar ese cambio";

export interface EngineAttachment {
  /** La ruta en `design-assets`. */
  path: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface EngineInput {
  mode: Exclude<DesignerMode, "correct">;
  workspaceId: string;
  format: FormatKey;
  isTemplate: boolean;
  style: DesignStyle;
  brand: PromptBrand;
  languageStyle: string;
  allowedFonts: readonly string[];
  variables?: readonly VariableGroup[];
  /** El documento sobre el que se pide (en la primera versión, el vacío). */
  doc: DesignDoc;
  request: string;
  scope: PatchScope;
  attachments: readonly EngineAttachment[];
  history?: readonly { role: "user" | "assistant"; content: string }[];
  contentContext?: ContentAiContext | null;
  multiPage?: boolean;
  /** El color de fondo cuando una imagen no existe. */
  fallbackBackground: string;
}

export interface EnginePorts {
  generate: DesignerGenerate;
  /** El servicio de render para medir; `null` si no se quiere medir. */
  measure: MeasureFn | null;
  /** Cada llamada al modelo suma su uso al costo de la corrida. */
  onUsage?: (usage: UsageLike | undefined) => void;
  nonce?: () => string;
}

export type EngineOutput =
  | {
      ok: true;
      /** El documento que dejó la IA (todavía sin fusionar con lo que la persona tocó). */
      doc: DesignDoc;
      /** Lo que la IA le dice a la persona. */
      message: string;
      /** Los avisos de la revisión (lo que no se pudo resolver o revisar). */
      warnings: string[];
      /** Lo que cree la IA que es el documento (certificado, constancia, diploma). */
      documentKind: DocumentKind | null;
      /** El parche normalizado (cambios y propuestas); `null` en la primera versión. */
      patch: DesignPatch | null;
      /** Lo que dejó la revisión automática (para `designs.last_qa`). */
      qa: { issues: QaIssue[]; unchecked: string[] };
      stats: { calls: number; corrections: number; attempts: number };
    }
  | { ok: false; message: string; problems: string[]; stats: { calls: number; corrections: number; attempts: number } };

const randomNonce = () => Math.random().toString(36).slice(2, 10);

/** Los textos de un documento (cada texto de cada página), ordenados: para comparar sin importar dónde estén. */
export function textsOf(doc: DesignDoc): string[] {
  const out: string[] = [];
  for (const page of doc.pages) for (const el of page.elements) if (el.type === "text") out.push(el.text);
  return out.sort();
}

/** Un cambio de estilo no puede cambiar los textos: devuelve el problema, o `null`. */
export function styleTextProblem(before: DesignDoc, after: DesignDoc): string | null {
  const a = textsOf(before);
  const b = textsOf(after);
  if (a.length === b.length && a.every((t, i) => t === b[i])) return null;
  return "El cambio de estilo tiene que conservar los textos tal cual: no cambies, no agregues ni quites ningún texto.";
}

type Candidate = { ok: true; doc: DesignDoc; message: string; documentKind: DocumentKind | null; patch: DesignPatch | null; warnings: string[] } | { ok: false; problems: string[] };

/** Valida un documento ya normalizado; devuelve el problema en español o el documento. */
function finalize(raw: unknown, ctx: NormalizeContext, base: DesignDoc): { ok: true; doc: DesignDoc; warnings: string[] } | { ok: false; problems: string[] } {
  const normalized = normalizeDoc(raw, ctx);
  const parsed = parseDesignDoc(normalized.doc);
  if (!parsed.ok) return { ok: false, problems: parsed.problems };
  // Última barrera: nada de HTML que no estuviera ya en el documento.
  const clean = sanitizeAiDoc(parsed.doc, base, ctx.assets.workspaceId);
  const warnings = clean.removed > 0 ? [...normalized.warnings, "Saqué un bloque de HTML que la IA no podía escribir."] : normalized.warnings;
  return { ok: true, doc: clean.doc, warnings };
}

export async function runDesignerEngine(input: EngineInput, ports: EnginePorts): Promise<EngineOutput> {
  const nonce = ports.nonce ?? randomNonce;
  const stats = { calls: 0, corrections: 0, attempts: 0 };
  const attachmentPaths = input.attachments.map((a) => a.path);
  const aliases = new AssetAliases(input.workspaceId, attachmentPaths, input.doc);
  const normalizeCtx: NormalizeContext = {
    format: input.format,
    allowedFonts: input.allowedFonts,
    assets: aliases,
    fallbackBackground: input.fallbackBackground,
    styleKey: input.style.key,
  };

  const aliasedDoc = input.mode === "first" ? undefined : aliases.aliasDoc(input.doc);
  const promptBase = (over: Partial<PromptInput>): PromptInput => ({
    mode: input.mode,
    format: input.format,
    isTemplate: input.isTemplate,
    style: input.style,
    brand: input.brand,
    languageStyle: input.languageStyle,
    allowedFonts: input.allowedFonts,
    variables: input.variables,
    scope: input.scope,
    doc: aliasedDoc,
    request: input.request,
    images: input.attachments.map((a) => ({ alias: aliases.aliasFor(a.path) ?? "imagen", name: a.name })),
    history: input.history,
    contentContext: input.contentContext,
    multiPage: input.multiPage,
    nonce: nonce(),
    ...over,
  });
  const images: DesignerImage[] = input.attachments.map((a) => ({ bytes: a.bytes, mediaType: a.mime }));
  const maxTokens = input.mode === "first" ? 14_000 : 9_000;

  // ── 1 y 2. Llamar, validar, reintentar una vez ────────────────────────────
  let candidate: Candidate = { ok: false, problems: [] };
  let retryProblems: string[] | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    stats.attempts++;
    const prompt = promptBase({ retryProblems });
    const system = buildSystemPrompt(prompt);
    const text = buildUserPrompt(prompt);
    stats.calls++;

    if (input.mode === "first") {
      const response = await ports.generate({ system, text, images, schema: aiDocOutputSchema, maxOutputTokens: maxTokens });
      ports.onUsage?.(response.usage);
      const out = parseAiDocOutput(response.object);
      if (!out.ok) {
        retryProblems = out.problems;
        candidate = { ok: false, problems: out.problems };
        continue;
      }
      const done = finalize({ v: 1, format: input.format, style: input.style.key, pages: out.value.doc.pages }, normalizeCtx, input.doc);
      if (!done.ok) {
        retryProblems = done.problems;
        candidate = { ok: false, problems: done.problems };
        continue;
      }
      candidate = { ok: true, doc: done.doc, message: out.value.message, documentKind: out.value.documentKind ?? null, patch: null, warnings: done.warnings };
      break;
    }

    const response = await ports.generate({ system, text, images, schema: aiPatchOutputSchema, maxOutputTokens: maxTokens });
    ports.onUsage?.(response.usage);
    const out = parseAiPatchOutput(response.object);
    if (!out.ok) {
      retryProblems = out.problems;
      candidate = { ok: false, problems: out.problems };
      continue;
    }
    // Un cambio de estilo o una propuesta sobre una imagen no cambian los textos de un bloque HTML cargado.
    if ((input.mode === "style" || input.mode === "propose_texts") && out.value.patch.pages.some((p) => p.ops.some((o) => o.op === "updateText"))) {
      const problem = "En este pedido no se pueden cambiar textos de bloques HTML (updateText).";
      retryProblems = [problem];
      candidate = { ok: false, problems: [problem] };
      continue;
    }
    const scope: PatchScope = input.mode === "propose_texts" ? { page: 0 } : input.scope;
    const applied = applyScoped(input.doc, out.value.patch, scope);
    if (!applied.ok) {
      retryProblems = applied.problems;
      candidate = { ok: false, problems: applied.problems };
      continue;
    }
    const done = finalize(applied.doc, { ...normalizeCtx, styleKey: input.mode === "style" ? input.style.key : (input.doc.style ?? undefined) }, input.doc);
    if (!done.ok) {
      retryProblems = done.problems;
      candidate = { ok: false, problems: done.problems };
      continue;
    }
    if (input.mode === "style") {
      const problem = styleTextProblem(input.doc, done.doc);
      if (problem) {
        retryProblems = [problem];
        candidate = { ok: false, problems: [problem] };
        continue;
      }
    }
    if (input.mode === "propose_texts" && done.doc.pages[0] && done.doc.pages[0].elements.length === input.doc.pages[0]?.elements.length) {
      retryProblems = ["La propuesta no agrega ningún texto."];
      candidate = { ok: false, problems: retryProblems };
      continue;
    }
    candidate = { ok: true, doc: done.doc, message: out.value.message, documentKind: out.value.documentKind ?? null, patch: out.value.patch, warnings: done.warnings };
    break;
  }

  if (!candidate.ok) return { ok: false, message: COULD_NOT_APPLY, problems: candidate.problems, stats };

  let doc = candidate.doc;
  const warnings = [...candidate.warnings];

  // Una propuesta (textos sobre una imagen base) no se revisa: todavía no se aplicó.
  if (input.mode === "propose_texts") {
    return { ok: true, doc, message: candidate.message, warnings, documentKind: candidate.documentKind, patch: candidate.patch, qa: { issues: [], unchecked: [] }, stats };
  }

  // ── 4. La foto de la portada y su capa de color (F33) ─────────────────────
  if (input.mode === "first") {
    doc = applyCoverImage(doc, attachmentPaths, input.format);
    doc = ensureOverlays(doc, input.format);
  } else {
    const touched = changedPageIndexes(input.doc, doc);
    if (touched.length) doc = ensureOverlays(doc, input.format, touched);
  }

  // ── 6. La revisión automática (F36) ───────────────────────────────────────
  const correct = async (request: CorrectionRequest): Promise<CorrectionResult> => {
    const scope: PatchScope = { pages: request.pages };
    const correctionAliases = new AssetAliases(input.workspaceId, attachmentPaths, request.doc);
    const prompt = promptBase({
      mode: "correct",
      scope,
      doc: correctionAliases.aliasDoc(request.doc),
      request: "Corregí los problemas que encontró la revisión automática.",
      qaProblems: qaProblemsForPrompt(request.issues),
      retryProblems: undefined,
      nonce: nonce(),
    });
    stats.calls++;
    const response = await ports.generate({
      system: buildSystemPrompt(prompt),
      text: buildUserPrompt(prompt),
      images: request.images.length ? request.images.map((bytes) => ({ bytes, mediaType: "image/png" })) : [],
      schema: aiPatchOutputSchema,
      maxOutputTokens: 9_000,
    });
    ports.onUsage?.(response.usage);
    const out = parseAiPatchOutput(response.object);
    if (!out.ok) return { ok: false };
    const applied = applyScoped(request.doc, out.value.patch, scope);
    if (!applied.ok) return { ok: false };
    const done = finalize(applied.doc, { ...normalizeCtx, assets: correctionAliases, styleKey: request.doc.style }, request.doc);
    if (!done.ok) return { ok: false };
    return { ok: true, doc: done.doc };
  };

  const qa = await runQaLoop(doc, { format: input.format, style: input.style, measure: ports.measure, correct });
  stats.corrections = qa.corrections;
  doc = qa.doc;
  warnings.push(...qaWarnings(qa.issues, doc), ...qa.unchecked);

  return { ok: true, doc, message: candidate.message, warnings, documentKind: candidate.documentKind, patch: candidate.patch, qa: { issues: qa.issues, unchecked: qa.unchecked }, stats };
}
