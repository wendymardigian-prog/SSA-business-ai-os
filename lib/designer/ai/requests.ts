/**
 * Lo que hacen las Server Actions de la IA del Diseñador, sin la sesión (F31, F35, F30, F47).
 *
 * Las acciones (`lib/actions/designer/ai.ts`) validan el permiso y sacan el
 * negocio y la persona de la SESIÓN; todo lo demás está acá, recibiendo el
 * cliente de servicio, así se prueba sin sesión ni base. Escribe siempre
 * filtrando por el negocio recibido, nunca por uno que mande el navegador.
 *
 * Un pedido es un mensaje de la persona en el hilo del Diseñador y un job
 * `design_ai_generate` que lo contesta. «Pendiente» = el último mensaje es de la
 * persona; no se acepta otro pedido hasta que llegue la respuesta.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { appendMessage, getOrCreateDesignerThread, listMessages, updateMessageResult, type AiMessageRow, type AiThreadRow } from "@/lib/ai-threads/store";
import { designerSubjectType, parseAttachments, type AiAttachment } from "@/lib/ai-threads/schema";
import { scheduleJob } from "@/lib/scheduler";
import type { Database } from "@/lib/types/database";
import type { ActionResult, ContentAiContext, DesignKind } from "../contracts";
import { parseDesignDoc } from "../doc/schema";
import { DESIGN_AI_GENERATE_JOB } from "../jobs/ai-generate";
import { pathBelongsTo } from "../storage";
import { validateTemplateVerification, type DocType } from "../verification";
import type { AiStatus, AnswerProposalResult, LoadConversationData, StyleOption } from "./action-types";
import { AssetAliases } from "./assets";
import { allowedFontsFor, loadWorkspaceContext, resolveStyle } from "./context";
import { isPending, toMessageViews, type MessageRow } from "./conversation";
import { sanitizeAiDoc } from "./doc-sanitize";
import { insertVersion, loadTarget, saveDocWithRev } from "./db";
import { normalizeDoc } from "./normalize";
import { applyScoped } from "./scope";
import { NO_AI_MESSAGE, hasConnectedAi } from "./provider";
import { parseAiPatch } from "./schema";
import { availableStyles, FACTORY_STYLES, findStyle } from "../styles";

type Db = SupabaseClient<Database>;

export const MAX_REQUEST_CHARS = 4_000;
export const MAX_ATTACHMENTS = 5;
export const STYLE_TEXT_FIRST = "Rehacé el diseño con el estilo";
export const PROPOSE_TEXTS_REQUEST = "Que la IA me proponga dónde van los textos y las variables.";
const IMAGE_ONLY_REQUEST = "Usá esta imagen.";
const BUSY = "Esperá a que la IA termine el pedido anterior.";

export interface RequestDeps {
  schedule?: typeof scheduleJob;
  now?: () => Date;
}

interface Who {
  workspaceId: string;
  userId: string;
}

const fail = (error: string) => ({ ok: false as const, error });

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Los adjuntos de un pedido: de este negocio, imágenes y hasta 5. */
export function checkRequestAttachments(workspaceId: string, attachments: readonly AiAttachment[] | undefined): { ok: true; value: AiAttachment[] } | { ok: false; error: string } {
  const parsed = parseAttachments(attachments ?? []);
  if (!parsed.ok) return fail("Los archivos adjuntos no son válidos.");
  if (parsed.value.length > MAX_ATTACHMENTS) return fail(`Se pueden adjuntar hasta ${MAX_ATTACHMENTS} imágenes por pedido.`);
  for (const a of parsed.value) {
    if (!pathBelongsTo(a.asset_path, workspaceId)) return fail("Una de las imágenes no es de este negocio.");
    if (!IMAGE_MIMES.has(a.mime)) return fail("Solo se pueden adjuntar imágenes PNG, JPG o WebP.");
  }
  return { ok: true, value: parsed.value };
}

async function findThread(db: Db, workspaceId: string, kind: DesignKind, id: string): Promise<AiThreadRow | null> {
  const { data, error } = await db
    .from("ai_threads")
    .select("id, workspace_id, channel, agent_id, user_id, contact_id, subject_type, subject_id, title, last_message_at, archived_at, created_by, created_at, updated_at")
    .eq("channel", "designer")
    .eq("subject_type", designerSubjectType(kind))
    .eq("subject_id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[designer-ai] no pude leer la conversación:", error.message);
    return null;
  }
  return (data as AiThreadRow | null) ?? null;
}

export interface SubmitInput extends Who {
  kind: DesignKind;
  id: string;
  mode: "first" | "change" | "style" | "propose_texts";
  text: string;
  /** Solo `change`: null = todo; un número = solo esa página (0 = la primera). */
  page?: number | null;
  attachments?: AiAttachment[];
  styleKey?: string | null;
  multiPage?: boolean;
  contentContext?: ContentAiContext;
  /** La `rev` sobre la que se pidió; sin ella, la vigente. */
  baseRev?: number;
}

/** Deja el pedido de la persona en el hilo y encola el job que lo contesta. */
export async function submitRequest(db: Db, input: SubmitInput, deps: RequestDeps = {}): Promise<ActionResult<{ threadId: string; messageId: string }>> {
  const now = deps.now ?? (() => new Date());
  const attachments = checkRequestAttachments(input.workspaceId, input.attachments);
  if (!attachments.ok) return fail(attachments.error);

  let text = (input.text ?? "").trim();
  if (text.length > MAX_REQUEST_CHARS) return fail(`El pedido es muy largo (hasta ${MAX_REQUEST_CHARS} caracteres).`);
  if (!text) {
    if (attachments.value.length === 0 && input.mode !== "style" && input.mode !== "propose_texts") return fail("Escribí qué querés que haga la IA.");
    text = IMAGE_ONLY_REQUEST;
  }

  const target = await loadTarget(db, input.workspaceId, input.kind, input.id);
  if (!target) return fail("No encontré ese diseño.");
  if (target.archived) return fail("El diseño está archivado: restauralo para pedirle cambios a la IA.");

  const page = input.mode === "change" && input.page != null ? input.page : null;
  if (page !== null && (!Number.isInteger(page) || page < 0 || page >= target.doc.pages.length)) return fail("Esa página ya no existe. Elegí otra.");

  if (!(await hasConnectedAi(input.workspaceId, db))) return fail(NO_AI_MESSAGE);

  const thread = await getOrCreateDesignerThread(db, { workspaceId: input.workspaceId, kind: input.kind, subjectId: input.id, userId: input.userId, title: target.name });
  const rows = (await listMessages(db, thread.id)) as unknown as MessageRow[];
  if (isPending(rows, now())) return fail(BUSY);

  const message = await appendMessage(db, thread, { role: "user", content: text, attachments: attachments.value, context: { scope: page !== null ? { page } : {} } });

  const payload = {
    workspaceId: input.workspaceId,
    kind: input.kind,
    targetId: input.id,
    threadId: thread.id,
    userMessageId: message.id,
    mode: input.mode,
    baseRev: input.baseRev ?? target.rev,
    userId: input.userId,
    styleKey: input.styleKey ?? null,
    ...(input.multiPage !== undefined ? { multiPage: input.multiPage } : {}),
    ...(input.contentContext ? { contentContext: input.contentContext } : {}),
    trigger: "manual" as const,
  };
  try {
    await (deps.schedule ?? scheduleJob)(db, DESIGN_AI_GENERATE_JOB, payload, now(), `design-ai:${message.id}`);
  } catch (error) {
    console.error("[designer-ai] no pude encolar el pedido:", error instanceof Error ? error.message : "error");
    // Sin esto el pedido quedaría «Diseñando…» para siempre.
    await appendMessage(db, thread, { role: "assistant", content: "No pude pasarle el pedido a la IA. Probá de nuevo.", result: { changed_pages: [], summary: "", error: "No pude encolar el pedido" } });
    return fail("No pude pasarle el pedido a la IA. Probá de nuevo.");
  }
  return { ok: true, data: { threadId: thread.id, messageId: message.id } };
}

/** Rehacer con otro estilo (F35): mismos textos, otra paleta, tipografía y composición. */
export async function submitStyleChange(db: Db, input: Who & { kind: DesignKind; id: string; style: string }, deps: RequestDeps = {}): Promise<ActionResult<{ messageId: string }>> {
  const workspace = await loadWorkspaceContext(db, input.workspaceId);
  if (!workspace) return fail("No pude leer los datos del negocio. Probá de nuevo.");
  const style = findStyle(input.style, workspace.customStyles);
  if (!style) return fail("Ese estilo no existe o está archivado.");
  const result = await submitRequest(
    db,
    { ...input, mode: "style", styleKey: style.key, text: `${STYLE_TEXT_FIRST} «${style.name}»: mismos textos, otra paleta, tipografía y composición.` },
    deps,
  );
  return result.ok ? { ok: true, data: { messageId: result.data.messageId } } : result;
}

/** «Que la IA me proponga dónde van los textos y las variables» sobre la imagen base de una plantilla (F30). */
export async function submitTextProposal(db: Db, input: Who & { templateId: string }, deps: RequestDeps = {}): Promise<ActionResult<{ messageId: string }>> {
  const target = await loadTarget(db, input.workspaceId, "template", input.templateId);
  if (!target) return fail("No encontré esa plantilla.");
  if (!target.doc.pages[0]?.background.image) return fail("La plantilla no tiene una imagen base para proponer los textos.");
  const result = await submitRequest(db, { workspaceId: input.workspaceId, userId: input.userId, kind: "template", id: input.templateId, mode: "propose_texts", text: PROPOSE_TEXTS_REQUEST }, deps);
  return result.ok ? { ok: true, data: { messageId: result.data.messageId } } : result;
}

/** Los estilos que ofrece el menú del panel: los de fábrica y los propios no archivados. */
export function styleOptions(custom: Parameters<typeof availableStyles>[0] = []): StyleOption[] {
  return availableStyles(custom).map((s) => ({ key: s.key, name: s.name, description: s.description ?? null, palette: s.palette, custom: !FACTORY_STYLES.some((f) => f.key === s.key) }));
}

/** La conversación de un diseño o plantilla para el panel, si la IA está conectada y los estilos que se ofrecen. */
export async function loadConversationView(db: Db, input: { workspaceId: string; kind: DesignKind; id: string }, now: Date = new Date()): Promise<ActionResult<LoadConversationData>> {
  const thread = await findThread(db, input.workspaceId, input.kind, input.id);
  const connected = await hasConnectedAi(input.workspaceId, db);
  const ai: AiStatus = { connected, message: connected ? null : NO_AI_MESSAGE };
  const workspace = await loadWorkspaceContext(db, input.workspaceId);
  const styles = styleOptions(workspace?.customStyles ?? []);
  if (!thread) return { ok: true, data: { threadId: null, messages: [], ai, styles, canManage: false } };
  const rows = (await listMessages(db, thread.id)) as unknown as MessageRow[];
  return { ok: true, data: { threadId: thread.id, messages: toMessageViews(rows, now), ai, styles, canManage: false } };
}

interface StoredProposal {
  kind: "template_texts" | "enable_verification";
  status: "pending" | "accepted" | "declined";
  payload?: Record<string, unknown>;
}

function proposalOf(row: AiMessageRow): { result: Record<string, unknown>; proposal: StoredProposal } | null {
  const result = row.result && typeof row.result === "object" && !Array.isArray(row.result) ? (row.result as Record<string, unknown>) : null;
  const proposal = result?.proposal;
  if (!result || !proposal || typeof proposal !== "object") return null;
  const p = proposal as Record<string, unknown>;
  if ((p.kind !== "template_texts" && p.kind !== "enable_verification") || (p.status !== "pending" && p.status !== "accepted" && p.status !== "declined")) return null;
  return { result, proposal: { kind: p.kind, status: p.status, payload: p.payload && typeof p.payload === "object" ? (p.payload as Record<string, unknown>) : undefined } };
}

const MAX_SAVE_ATTEMPTS = 3;

/** «Hacerlo / No» de una propuesta de la IA. */
export async function answerProposalRequest(db: Db, input: Who & { kind: DesignKind; id: string; messageId: string; accept: boolean }): Promise<AnswerProposalResult> {
  const thread = await findThread(db, input.workspaceId, input.kind, input.id);
  if (!thread) return fail("No encontré la conversación.");
  const { data, error } = await db
    .from("ai_messages")
    .select("id, workspace_id, thread_id, role, content, attachments, context, result, citations, agent_run_id, feedback, created_at")
    .eq("id", input.messageId)
    .eq("thread_id", thread.id)
    .maybeSingle();
  if (error || !data) return fail("No encontré esa propuesta.");
  const found = proposalOf(data as AiMessageRow);
  if (!found) return fail("Ese mensaje no tiene ninguna propuesta.");
  if (found.proposal.status !== "pending") return fail("Esa propuesta ya fue respondida.");
  const { result, proposal } = found;

  const mark = async (status: "accepted" | "declined") => {
    await updateMessageResult(db, thread, input.messageId, { ...result, proposal: { ...proposal, status } });
  };

  if (!input.accept) {
    await mark("declined");
    return { ok: true, data: {} };
  }

  const target = await loadTarget(db, input.workspaceId, input.kind, input.id);
  if (!target) return fail("No encontré ese diseño.");

  // ── Prender la verificación (F47): solo plantillas impresas, con el tipo que reconoció la IA ──
  if (proposal.kind === "enable_verification") {
    if (input.kind !== "template" || !target.template) return fail("La verificación es solo de plantillas.");
    const docType = proposal.payload?.doc_type;
    if (docType !== "certificado" && docType !== "constancia" && docType !== "diploma") return fail("La propuesta no trae el tipo de documento.");
    const problems = validateTemplateVerification({ format: target.format, verify: true, doc_type: docType as DocType, doc_type_label: null });
    if (problems.length) return fail(problems[0]);
    const { error: updateError } = await db.from("design_templates").update({ verify: true, doc_type: docType }).eq("id", target.id).eq("workspace_id", input.workspaceId);
    if (updateError) {
      console.error("[designer-ai] no pude prender la verificación:", updateError.message);
      return fail("No pude prender la verificación. Probá de nuevo.");
    }
    await mark("accepted");
    return { ok: true, data: {} };
  }

  // ── Los textos propuestos sobre la imagen base (F30) ──
  const patch = parseAiPatch(proposal.payload?.patch);
  if (!patch.ok) return fail("La propuesta ya no se puede aplicar. Pedila de nuevo.");
  const workspace = await loadWorkspaceContext(db, input.workspaceId);
  if (!workspace) return fail("No pude leer los datos del negocio. Probá de nuevo.");

  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
    const current = attempt === 0 ? target : await loadTarget(db, input.workspaceId, input.kind, input.id);
    if (!current) return fail("No encontré ese diseño.");
    const style = resolveStyle(current.style, workspace.customStyles);
    const applied = applyScoped(current.doc, patch.value, { page: 0 });
    if (!applied.ok) return fail("La propuesta ya no calza con el diseño (la página cambió). Pedila de nuevo.");
    const normalized = normalizeDoc(applied.doc, {
      format: current.format,
      allowedFonts: allowedFontsFor(workspace, style, current.doc),
      assets: new AssetAliases(input.workspaceId, [], current.doc),
      fallbackBackground: style.palette.bg,
      styleKey: current.doc.style,
    });
    const valid = parseDesignDoc(normalized.doc);
    if (!valid.ok) return fail("La propuesta no se pudo aplicar. Pedila de nuevo.");
    const clean = sanitizeAiDoc(valid.doc, current.doc, input.workspaceId).doc;
    const rev = await saveDocWithRev(db, { workspaceId: input.workspaceId, kind: input.kind, id: input.id, rev: current.rev, doc: clean });
    if (rev === null) continue;
    await insertVersion(db, { workspaceId: input.workspaceId, kind: input.kind, id: input.id, doc: clean, reason: "ai", authorKind: "ai", authorId: null, createdBy: input.userId });
    await mark("accepted");
    return { ok: true, data: { rev } };
  }
  return fail("Hubo cambios al mismo tiempo y no pude aplicar la propuesta. Probá de nuevo.");
}
