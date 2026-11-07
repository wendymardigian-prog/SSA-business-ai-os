/**
 * El job `design_ai_generate`: la IA diseña o cambia un diseño o una plantilla
 * (F33, F34, F35, F38 y las propuestas de F30 y F47).
 *
 * Un job es UN pedido de la persona (un mensaje suyo en el hilo del Diseñador):
 *   - `first`          la primera versión (documento completo);
 *   - `change`         un cambio (parche), de todo o de una página;
 *   - `style`          rehacer con otro estilo conservando los textos;
 *   - `propose_texts`  proponer textos y variables sobre una imagen base
 *                      (no guarda el diseño: deja una propuesta «Hacerlo / No»).
 *
 * Qué hace, en orden: lee el diseño y el negocio; elige el modelo del negocio;
 * mira el tope de gasto ANTES de llamar; abre la corrida (`agent_runs`,
 * `source = 'designer'`); corre el motor (`lib/designer/ai/run.ts`); fusiona con
 * lo que la persona tocó mientras tanto; guarda con control de `rev` y una
 * versión (`reason = 'ai'`); y deja la respuesta en el hilo, con el costo.
 *
 * NUNCA lanza por un fallo del proveedor: reagenda a 1, 5 y 15 minutos con
 * `scheduleJob` (la cola reintentaría a los 10 s encima de esa espera) y, agotados
 * los intentos, deja la respuesta del hilo con el error. Todo lo demás (sin IA
 * conectada, tope alcanzado, respuesta que no valida) termina con un mensaje.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { openAiRun, type AiRunHandle } from "@/lib/ai/run";
import { withinWorkspaceBudget, type BudgetDecision } from "@/lib/ai/workspace-budget";
import { appendMessage, getOrCreateDesignerThread, listMessages, type AiThreadRow } from "@/lib/ai-threads/store";
import { parseAttachments } from "@/lib/ai-threads/schema";
import { scheduleJob } from "@/lib/scheduler";
import type { Database } from "@/lib/types/database";
import type { ContentAiContext, DesignKind } from "../contracts";
import { parseDesignDoc, type DesignDoc } from "../doc/schema";
import { allowedFontsFor, loadWorkspaceContext, resolveStyle, type DesignerWorkspaceContext } from "../ai/context";
import { budgetBlockMessage } from "../ai/cost";
import { hasAnswer, recentHistory, type MessageRow } from "../ai/conversation";
import { sanitizeAiDoc } from "../ai/doc-sanitize";
import { decideAiFailure, isTruncated } from "../ai/retry";
import { insertVersion, loadTarget, saveDocWithRev, type TargetRow } from "../ai/db";
import { keptManualNotice, mergeAiPatch } from "../ai/merge";
import { makeMeasure, type MeasureFn } from "../ai/measure";
import { changedPageIndexes, describeChange } from "../ai/patch";
import { detectDocType, textsProposalContent, verificationProposal } from "../ai/proposals";
import { NO_AI_MESSAGE, aiSdkDesignerGenerate, resolveDesignerModel, type DesignerGenerate } from "../ai/provider";
import { storedQa } from "../ai/qa";
import { runDesignerEngine, type EngineAttachment, type EngineInput, type EngineOutput } from "../ai/run";
import { checkImageUpload, DESIGN_ASSETS_BUCKET, pathBelongsTo } from "../storage";
import { enqueueDesignRender } from "./render";
import { sampleValues, variableGroups } from "../variables/catalog";

export const DESIGN_AI_GENERATE_JOB = "design_ai_generate";

type Db = SupabaseClient<Database>;

export const aiGeneratePayloadSchema = z.object({
  workspaceId: z.string().min(1),
  kind: z.enum(["design", "template"]),
  targetId: z.string().min(1),
  threadId: z.string().min(1),
  /** El mensaje de la persona al que contesta este job. */
  userMessageId: z.string().min(1),
  mode: z.enum(["first", "change", "style", "propose_texts"]),
  /** La `rev` del documento cuando se pidió. */
  baseRev: z.number().int().min(0),
  userId: z.string().nullable().optional(),
  /** Con `style`: la clave del estilo nuevo; con `first`: el elegido al crear. */
  styleKey: z.string().max(40).nullable().optional(),
  multiPage: z.boolean().optional(),
  contentContext: z.custom<ContentAiContext>().optional(),
  /** Cuántas veces ya se reintentó por un fallo del proveedor. */
  retry: z.number().int().min(0).max(10).optional(),
  trigger: z.enum(["job", "manual"]).optional(),
});
export type AiGeneratePayload = z.infer<typeof aiGeneratePayloadSchema>;

export interface AiGenerateDeps {
  /** El modelo simulado de los tests. Sin esto se usa el del negocio. */
  model?: { generate: DesignerGenerate; provider: string; modelId: string } | null;
  /** `null`: sin servicio de render. Sin esto, el de verdad (`makeMeasure`). */
  measure?: MeasureFn | null;
  budget?: (db: Db, workspaceId: string, now: Date, opts: { model: { provider: string; model: string } | null }) => Promise<BudgetDecision>;
  openRun?: typeof openAiRun;
  schedule?: typeof scheduleJob;
  now?: () => Date;
  nonce?: () => string;
}

export type AiGenerateOutcome =
  | { status: "done"; mode: AiGeneratePayload["mode"]; runId: string | null }
  | { status: "proposed"; runId: string | null }
  | { status: "failed"; reason: "no_ai" | "budget" | "invalid" | "gone" | "conflict" | "error"; message: string }
  | { status: "retry"; attempt: number; at: string }
  | { status: "skipped"; reason: "bad_payload" | "no_message" | "already_answered" };

const MAX_SAVE_ATTEMPTS = 3;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Deja la respuesta del hilo con el error (la persona la ve y puede volver a pedir). */
async function answerWithError(db: Db, thread: Pick<AiThreadRow, "id" | "workspace_id" | "channel">, message: string, runId: string | null): Promise<void> {
  try {
    await appendMessage(db, thread, { role: "assistant", content: message, result: { changed_pages: [], summary: "", error: clip(message, 500) }, agentRunId: runId });
  } catch (error) {
    console.error("[design_ai_generate] no pude dejar el error en el hilo:", error instanceof Error ? error.message : "error");
  }
}

/** Las imágenes que le llegan a la IA: las adjuntas del pedido (o la imagen base) bajadas del Storage y validadas por sus bytes. */
async function loadAttachments(db: Db, workspaceId: string, paths: { path: string; name: string }[]): Promise<{ list: EngineAttachment[]; skipped: number }> {
  const list: EngineAttachment[] = [];
  let skipped = 0;
  for (const item of paths.slice(0, 6)) {
    if (!pathBelongsTo(item.path, workspaceId)) {
      skipped++;
      continue;
    }
    try {
      const { data, error } = await db.storage.from(DESIGN_ASSETS_BUCKET).download(item.path);
      if (error || !data) {
        skipped++;
        continue;
      }
      const bytes = new Uint8Array(await data.arrayBuffer());
      const check = checkImageUpload(bytes);
      if (!check.ok) {
        skipped++;
        continue;
      }
      list.push({ path: item.path, name: item.name, mime: check.mime, bytes });
    } catch {
      skipped++;
    }
  }
  return { list, skipped };
}

function failureText(error: unknown, permanent: boolean): string {
  if (isTruncated(error)) return "La respuesta de la IA quedó demasiado larga y se cortó. Probá pidiendo menos cosas a la vez.";
  if (permanent) return "El proveedor de IA rechazó el pedido. Revisá la conexión de la IA en Configuración e intentá de nuevo.";
  return "La IA no respondió después de varios intentos. Probá de nuevo en un rato.";
}

export async function runAiGenerate(db: Db, rawPayload: Record<string, unknown>, deps: AiGenerateDeps = {}): Promise<AiGenerateOutcome> {
  const parsed = aiGeneratePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.error("[design_ai_generate] el job no trae lo necesario");
    return { status: "skipped", reason: "bad_payload" };
  }
  const payload = parsed.data;
  const now = deps.now ?? (() => new Date());
  const { workspaceId } = payload;

  // El hilo y el pedido de la persona.
  let rows: MessageRow[];
  let thread: AiThreadRow;
  try {
    thread = await getOrCreateDesignerThread(db, { workspaceId, kind: payload.kind, subjectId: payload.targetId, userId: payload.userId ?? null });
    rows = (await listMessages(db, thread.id)) as unknown as MessageRow[];
  } catch (error) {
    console.error("[design_ai_generate] no pude leer la conversación:", error instanceof Error ? error.message : "error");
    return { status: "skipped", reason: "no_message" };
  }
  const request = rows.find((r) => r.id === payload.userMessageId && r.role === "user");
  if (!request) return { status: "skipped", reason: "no_message" };
  if (hasAnswer(rows, request.id)) return { status: "skipped", reason: "already_answered" };

  const fail = async (reason: Extract<AiGenerateOutcome, { status: "failed" }>["reason"], message: string, runId: string | null = null) => {
    await answerWithError(db, thread, message, runId);
    return { status: "failed", reason, message } satisfies AiGenerateOutcome;
  };

  const target = await loadTarget(db, workspaceId, payload.kind, payload.targetId);
  if (!target) return fail("gone", "El diseño ya no existe o no se puede abrir.");
  const workspace = await loadWorkspaceContext(db, workspaceId);
  if (!workspace) return fail("error", "No pude leer los datos del negocio. Probá de nuevo.");

  // El modelo del negocio (BYOK). Sin ninguna IA conectada, el resto del Diseñador sigue andando.
  let model = deps.model ?? null;
  if (!model) {
    const resolved = await resolveDesignerModel(workspaceId, db);
    if (!resolved.ok) return fail("no_ai", resolved.problem === "no_provider" ? NO_AI_MESSAGE : resolved.message);
    model = { generate: aiSdkDesignerGenerate(resolved.model), provider: resolved.provider, modelId: resolved.modelId };
  }

  // F38: el tope de gasto ANTES de llamar. Con el tope alcanzado NO se llama al proveedor.
  const budget = await (deps.budget ?? withinWorkspaceBudget)(db, workspaceId, now(), { model: { provider: model.provider, model: model.modelId } });
  const blocked = budgetBlockMessage(budget);
  if (blocked) return fail("budget", blocked);

  const run: AiRunHandle = await (deps.openRun ?? openAiRun)(db, { workspaceId, source: "designer", trigger: payload.trigger ?? "job", threadId: thread.id, provider: model.provider, model: model.modelId });

  try {
    return await work({ db, deps, now, payload, thread, rows, request, target, workspace, model, run, fail });
  } catch (error) {
    // Un fallo del proveedor (o cualquier otro imprevisto): nunca se lanza, se reagenda o se avisa.
    const decision = decideAiFailure(error, payload.retry ?? 0);
    const detail = error instanceof Error ? error.name : "error";
    console.error("[design_ai_generate] falló la llamada a la IA:", detail);
    if (decision.action === "retry") {
      const at = new Date(now().getTime() + decision.delayMs);
      try {
        await (deps.schedule ?? scheduleJob)(db, DESIGN_AI_GENERATE_JOB, { ...payload, retry: decision.nextRetry }, at);
        await run.close({ status: "error", statusDetail: "retry_scheduled", error: "reintento programado" });
        return { status: "retry", attempt: decision.nextRetry, at: at.toISOString() };
      } catch (scheduleError) {
        console.error("[design_ai_generate] no pude reagendar:", scheduleError instanceof Error ? scheduleError.message : "error");
      }
    }
    await run.close({ status: "error", statusDetail: "provider_failed", error: decision.action === "give_up" ? decision.message : "no se pudo reagendar" });
    const text = failureText(error, decision.action === "give_up" && decision.permanent);
    return fail("error", text, run.runId);
  }
}

interface WorkContext {
  db: Db;
  deps: AiGenerateDeps;
  now: () => Date;
  payload: AiGeneratePayload;
  thread: AiThreadRow;
  rows: MessageRow[];
  request: MessageRow;
  target: TargetRow;
  workspace: DesignerWorkspaceContext;
  model: { generate: DesignerGenerate; provider: string; modelId: string };
  run: AiRunHandle;
  fail: (reason: Extract<AiGenerateOutcome, { status: "failed" }>["reason"], message: string, runId?: string | null) => Promise<AiGenerateOutcome>;
}

async function work(ctx: WorkContext): Promise<AiGenerateOutcome> {
  const { db, deps, now, payload, thread, rows, request, target, workspace, model, run } = ctx;
  const style = resolveStyle(payload.styleKey ?? target.style, workspace.customStyles);
  const context = request.context && typeof request.context === "object" ? (request.context as { scope?: { page?: number } }) : {};
  const scopePage = typeof context.scope?.page === "number" ? context.scope.page : null;

  // Las imágenes: las del pedido, o (propuesta de textos) la imagen base de la página 1.
  let attachmentPaths: { path: string; name: string }[];
  if (payload.mode === "propose_texts") {
    const image = target.doc.pages[0]?.background.image;
    attachmentPaths = image ? [{ path: image.asset, name: "imagen base" }] : [];
  } else {
    const list = parseAttachments(request.attachments);
    attachmentPaths = list.ok ? list.value.map((a) => ({ path: a.asset_path, name: a.name })) : [];
  }
  const attachments = await loadAttachments(db, target.workspaceId, attachmentPaths);

  const uploadedFonts = workspace.uploadedFonts;
  const measure: MeasureFn | null =
    deps.measure !== undefined
      ? deps.measure
      : makeMeasure({ db, workspaceId: target.workspaceId, uploadedFonts, values: target.template ? sampleValues({ customVars: target.template.customVars, workspaceName: workspace.brand.name }) : undefined });

  const isTemplate = target.kind === "template";
  const engineInput: EngineInput = {
    mode: payload.mode,
    workspaceId: target.workspaceId,
    format: target.format,
    isTemplate,
    style,
    brand: workspace.brand,
    languageStyle: workspace.languageStyle,
    allowedFonts: allowedFontsFor(workspace, style, target.doc),
    variables: isTemplate ? variableGroups({ customVars: target.template?.customVars, verify: target.template?.verify }) : undefined,
    doc: target.doc,
    request: request.content,
    scope: { page: payload.mode === "change" ? scopePage : null },
    attachments: attachments.list,
    history: recentHistory(rows, request.id),
    contentContext: payload.contentContext ?? null,
    multiPage: payload.multiPage,
    fallbackBackground: style.palette.bg,
  };

  const out: EngineOutput = await runDesignerEngine(engineInput, { generate: model.generate, measure, onUsage: (u) => run.addStepUsage(u), nonce: deps.nonce });

  if (!out.ok) {
    await run.close({ status: "error", statusDetail: "invalid_output", error: clip(out.problems.join("; "), 400) });
    return ctx.fail("invalid", out.message, run.runId);
  }

  const aiDocKind = detectDocType(out.documentKind, request.content);
  const verifyProposal =
    payload.mode === "first" || payload.mode === "propose_texts"
      ? verificationProposal({ isTemplate, format: target.format, alreadyVerifies: target.template?.verify === true, docType: aiDocKind })
      : null;

  // ── Propuesta de textos sobre una imagen base: no se guarda nada, queda esperando «Hacerlo / No» ──
  if (payload.mode === "propose_texts") {
    await run.close({ status: "responded", statusDetail: "proposal" });
    await appendMessage(db, thread, {
      role: "assistant",
      content: textsProposalContent(out.message),
      result: { changed_pages: [], summary: "", proposal: { kind: "template_texts", status: "pending", payload: { patch: out.patch, baseRev: target.rev } }, ...(out.warnings.length ? { warnings: out.warnings.map((w) => clip(w, 300)).slice(0, 40) } : {}) },
      agentRunId: run.runId,
    });
    if (verifyProposal) {
      await appendMessage(db, thread, {
        role: "assistant",
        content: verifyProposal.text,
        result: { changed_pages: [], summary: "", proposal: { kind: verifyProposal.kind, status: verifyProposal.status, payload: verifyProposal.payload } },
      });
    }
    return { status: "proposed", runId: run.runId };
  }

  // ── Guardar: fusionar con lo que la persona tocó mientras tanto y guardar con control de `rev` ──
  const baseDoc = target.doc;
  let saved: { doc: DesignDoc; rev: number; before: DesignDoc; keptNotice: string | null; keptManual: string[]; published: boolean } | null = null;
  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS && !saved; attempt++) {
    // Siempre se vuelve a leer: durante la llamada la persona pudo haber guardado cambios.
    const fresh = await loadTarget(db, target.workspaceId, target.kind, target.id);
    if (!fresh) return ctx.fail("gone", "El diseño ya no existe o no se puede abrir.", run.runId);
    const mine = fresh.doc;
    const rev = fresh.rev;
    const merged = mergeAiPatch(baseDoc, mine, out.doc);
    const parsedMerge = parseDesignDoc(merged.doc);
    if (!parsedMerge.ok) {
      await run.close({ status: "error", statusDetail: "merge_invalid", error: clip(parsedMerge.problems.join("; "), 400) });
      return ctx.fail("invalid", "No pude aplicar ese cambio", run.runId);
    }
    // Lo que se guarda es lo que devuelve la limpieza: nada de HTML que no estuviera ya en el diseño.
    const valid = { ok: true as const, doc: sanitizeAiDoc(parsedMerge.doc, mine).doc };
    if (payload.mode === "style") {
      // Para poder volver atrás: el diseño de antes queda como versión.
      await insertVersion(db, { workspaceId: target.workspaceId, kind: target.kind, id: target.id, doc: mine, reason: "manual", authorKind: "user", authorId: payload.userId ?? null, createdBy: payload.userId ?? null });
    }
    const newRev = await saveDocWithRev(db, {
      workspaceId: target.workspaceId,
      kind: target.kind,
      id: target.id,
      rev,
      doc: valid.doc,
      style: payload.mode === "style" || payload.mode === "first" ? style.key : undefined,
      lastQa: target.kind === "design" ? storedQa(out.qa.issues, out.qa.unchecked, now()) : undefined,
    });
    if (newRev === null) continue; // otra persona guardó en el medio: se vuelve a leer y a fusionar
    saved = { doc: valid.doc, rev: newRev, before: mine, keptNotice: keptManualNotice(merged), keptManual: merged.keptManual, published: fresh.published === true };
  }
  if (!saved) {
    await run.close({ status: "error", statusDetail: "rev_conflict" });
    return ctx.fail("conflict", "Hubo muchos cambios a la vez y no pude guardar el de la IA. Volvé a pedirlo.", run.runId);
  }

  await insertVersion(db, { workspaceId: target.workspaceId, kind: target.kind, id: target.id, doc: saved.doc, reason: "ai", authorKind: "ai", authorId: null, createdBy: payload.userId ?? null });

  // Un diseño que ya tiene link público: sus archivos se vuelven a renderizar con el cambio (nunca lanza).
  if (target.kind === "design" && saved.published) {
    try {
      await enqueueDesignRender(db, { designId: target.id, purpose: "publish" });
    } catch (error) {
      console.error("[design_ai_generate] no pude encolar el render del diseño publicado:", error instanceof Error ? error.message : "error");
    }
  }

  const changedPages = changedPageIndexes(saved.before, saved.doc);
  const pages = saved.doc.pages.length;
  const summary = payload.mode === "first" ? `Creó ${pages} ${pages === 1 ? "página" : "páginas"}` : (describeChange(saved.before, saved.doc) ?? "");
  const warnings = [...out.warnings, ...(attachments.skipped > 0 ? ["No pude usar alguna de las imágenes adjuntas."] : []), ...(saved.keptNotice ? [saved.keptNotice] : [])].map((w) => clip(w, 300)).slice(0, 40);

  await run.close({ status: "responded", statusDetail: payload.mode });
  // El diseño ya está guardado: si dejar la respuesta en el hilo falla, NO se lanza (el job se reintentaría y la IA
  // aplicaría el cambio dos veces). Se intenta una respuesta mínima.
  const answer = {
    role: "assistant" as const,
    content: verifyProposal ? `${out.message.trim()}\n\n${verifyProposal.text}` : out.message,
    result: {
      changed_pages: changedPages.slice(0, 35),
      summary: clip(summary, 2000),
      ...(warnings.length ? { warnings } : {}),
      ...(saved.keptManual.length ? { kept_manual: saved.keptManual.slice(0, 200) } : {}),
      ...(verifyProposal ? { proposal: { kind: verifyProposal.kind, status: verifyProposal.status, payload: verifyProposal.payload } } : {}),
    },
    agentRunId: run.runId,
  };
  try {
    await appendMessage(db, thread, answer);
  } catch (error) {
    console.error("[design_ai_generate] no pude dejar la respuesta en el hilo:", error instanceof Error ? error.message : "error");
    await answerWithError(db, thread, "La IA hizo el cambio pero no pude dejar el detalle acá. Recargá el diseño.", run.runId);
  }
  return { status: "done", mode: payload.mode, runId: run.runId };
}
