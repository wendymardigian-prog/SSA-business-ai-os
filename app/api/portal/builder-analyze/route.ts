// @plantilla-quitar(proyectos)
/**
 * El análisis con IA de un paso (Corrida C, F236). El portal no tiene keys de IA: pide, firmado, que el revisor del
 * programa analice la última versión del documento de un paso. La base valida acceso, créditos, que no sea una llamada
 * simulada y uno por paso a la vez (`portal_builder_analyze_begin`); acá se corre el modelo del revisor con las
 * instrucciones del paso y se guarda el resultado (`portal_builder_analyze_finish`). Si la IA falla o no cumple el
 * esquema, no se guarda y la corrida se cierra SIN uso: no se cobra.
 */
import { NextResponse, type NextRequest } from "next/server";
import { generateText } from "ai";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc } from "@/lib/services/db";
import { verifyPortalRequest } from "@/lib/portal-admin/portal-signature";
import { openAiRun } from "@/lib/ai/run";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { newNonce } from "@/lib/agent/untrusted";
import { analysisRules, analysisUserMessage, parseAnalysis } from "@/lib/projects/analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9_]{1,40}$/;
const FAILED = "No pudimos analizarlo. Probá de nuevo";

interface Begin {
  workspace_id: string;
  contact_id: string;
  product_id: string;
  agent_id: string;
  step: { key: string; name: string };
  instructions: { text: string; version: number };
  document: { n: number; path: string };
  depends: Array<{ step: string; name: string | null; version: { n: number; path: string } | null }>;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (body.length > 2000) return NextResponse.json({ ok: false }, { status: 413 });
  const okSig = verifyPortalRequest({
    secret: process.env.PORTAL_SHARED_SECRET,
    timestamp: request.headers.get("x-portal-timestamp"),
    signature: request.headers.get("x-portal-signature"),
    body,
    nowMs: Date.now(),
  });
  if (!okSig) return NextResponse.json({ ok: false }, { status: 401 });
  let input: { session?: unknown; project_id?: unknown; step?: unknown };
  try {
    input = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof input.session !== "string" || typeof input.project_id !== "string" || !UUID.test(input.project_id) || typeof input.step !== "string" || !KEY.test(input.step)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const projectId = input.project_id;
  const stepKey = input.step;

  const db = await createServiceClient();
  const begun = await svcRpc<Begin>(db, "portal_builder_analyze_begin", { p_session: input.session, p_project_id: projectId, p_step: stepKey });
  if (!begun.ok) {
    const po = begun.error.code && /^PO\d{3}$/.test(begun.error.code);
    return NextResponse.json({ ok: false, code: po ? begun.error.code : null, message: po ? begun.error.message : FAILED }, { status: po ? 403 : 502 });
  }
  const b = begun.data;
  const fail = async (runClose?: () => Promise<unknown>) => {
    await runClose?.();
    await svcRpc(db, "portal_builder_analyze_fail", { p_project_id: projectId, p_step: stepKey });
    return NextResponse.json({ ok: false, code: null, message: FAILED }, { status: 502 });
  };

  const { data: agent } = await db.from("agents").select("system_prompt, provider, model, temperature, max_output_tokens").eq("id", b.agent_id).maybeSingle();
  if (!agent) return fail();
  const run = await openAiRun(db, { workspaceId: b.workspace_id, source: "portal_project_review", trigger: "manual", agentId: b.agent_id, contactId: b.contact_id, threadId: projectId, provider: agent.provider ?? null, model: agent.model ?? null });
  // Sin uso registrado, la corrida cuesta 0: un análisis fallido no se cobra.
  const closeFailed = (detail: string) => () => run.close({ status: "error", statusDetail: detail, error: detail });

  try {
    const budget = await withinWorkspaceBudget(db, b.workspace_id);
    if (!budget.allowed) return fail(closeFailed("budget_exceeded"));
    const read = async (path: string | null | undefined) => {
      if (!path) return null;
      const { data } = await db.storage.from("student-projects").download(path);
      return data ? await data.text() : null;
    };
    const docText = await read(b.document.path);
    if (docText === null) return fail(closeFailed("document_missing"));
    const deps = await Promise.all(b.depends.map(async (d) => ({ name: d.name ?? d.step, text: await read(d.version?.path) })));
    const resolved = await getWorkspaceModel(b.workspace_id, { preferredProvider: agent.provider ?? undefined, modelId: agent.model ?? undefined, supabase: db });
    if (!resolved.ok || !resolved.model) return fail(closeFailed(resolved.problem ?? "no_provider"));
    run.setModel(resolved.provider ?? "", resolved.modelId ?? "");
    const nonce = newNonce();
    const user = analysisUserMessage(nonce, { name: b.step.name, text: docText }, deps);
    const system = [agent.system_prompt?.trim() || "Sos el revisor de proyectos del programa. Analizás documentos de estudiantes con criterios claros y evidencia.", `Instrucciones del análisis de «${b.step.name}» (versión ${b.instructions.version}):\n${b.instructions.text}`, analysisRules(nonce, stepKey === "llamada")].join("\n\n");
    const result = await generateText({ model: resolved.model, system, messages: [{ role: "user", content: user.text }], temperature: Math.min(Number(agent.temperature ?? 0.2), 0.7), maxOutputTokens: Math.max(Number(agent.max_output_tokens ?? 0), 2000) });
    const parsed = parseAnalysis(result.text);
    if (!parsed) return fail(closeFailed("invalid_schema"));
    run.setFinalUsage(result.totalUsage);
    const closed = await run.close({ status: "completed" });
    const { data: prod } = await db.from("products").select("portal_settings").eq("id", b.product_id).maybeSingle();
    const perUsd = Number(((prod as { portal_settings?: { assistant?: { credits_per_usd?: number } } } | null)?.portal_settings?.assistant?.credits_per_usd) ?? 100) || 100;
    const credits = Math.max(1, Math.round((closed.costUsd ?? 0) * perUsd));
    const saved = await svcRpc(db, "portal_builder_analyze_finish", { p_project_id: projectId, p_step: stepKey, p_run_id: run.runId, p_of: b.document.n, p_result: parsed, p_credits: credits });
    if (!saved.ok) return fail();
    return NextResponse.json({ ok: true, of: b.document.n, credits, truncated: user.truncated });
  } catch (err) {
    console.error("[portal-review] falló el análisis:", err instanceof Error ? err.message : "error desconocido");
    return fail(closeFailed("generation_failed"));
  }
}
