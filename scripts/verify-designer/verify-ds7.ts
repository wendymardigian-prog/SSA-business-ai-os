/**
 * verify-designer · bloque ds7 (F57–F60): el paso «Generar desde plantilla» de punta a punta, contra la base real y con
 * el render simulado (`DESIGNER_FAKE_RENDER=1`, lo pone `verify-designer.mjs`).
 *
 * - Un formulario de prueba REAL con la pregunta `nombre_certificado`, publicado y respondido con `submit_form_response`;
 *   las variables de la corrida se arman con el mismo código del disparador «Formulario enviado» (`formVariables`). La
 *   generación queda con ese nombre en `values`, origen `automation` con la sesión, lista (render simulado) y las seis salidas.
 * - Con la respuesta vacía y «No generar»: el camino termina con el error y la generación queda `failed`.
 * - «Enviar email» con el PDF: la carga encuentra la generación de la corrida y su PDF.
 * - «Automatizar» (F60): el borrador pasa la validación salvo el formulario.
 */

import { randomUUID } from "node:crypto";
import { runDesignGenerate } from "../../lib/flow-engine/nodes/design-generate";
import { formVariables } from "../../lib/forms/automation/variables";
import { DESIGN_STOP_HANDLE } from "../../lib/designer/automation/node-config";
import { designFlowTemplate, FORM_NOT_CHOSEN_PROBLEM } from "../../lib/designer/automation/flow-template";
import { loadEmailAttachments } from "../../lib/email/flow-attachments";
import { triggerProblems } from "../../lib/flow-engine/publish-rules";
import { configProblems } from "../../lib/flow-engine/node-requirements";
import type { FlowExecutionContext } from "../../lib/flow-engine/types";
import { check, makeWorkspace, raw, svc, type BlockContext } from "./helpers";

function certificateDoc() {
  return {
    v: 1,
    format: "a4_h",
    pages: [
      {
        id: "pg_test0001",
        background: { type: "color", color: "#ffffff" },
        elements: [
          { id: "el_test0001", type: "text", x: 50, y: 40, w: 80, text: "Constancia para {{nombre_en_el_certificado}}", font: { family: "Inter", weight: 700 }, size: 48, align: "center", color: "#111111" },
          { id: "el_test0002", type: "text", x: 50, y: 70, w: 60, text: "Código {{design.code}}", font: { family: "Inter", weight: 400 }, size: 20, align: "center", color: "#111111" },
        ],
      },
    ],
  };
}

export default async function ds7(ctx: BlockContext): Promise<void> {
  if (process.env.DESIGNER_FAKE_RENDER !== "1") {
    check(false, "este bloque corre con DESIGNER_FAKE_RENDER=1 (nunca contra el render real)");
    return;
  }
  console.log("\n— Preparación —");
  const t = await makeWorkspace("ds7");
  const { data: contact } = await raw.from("contacts").insert({ workspace_id: t.id, display_name: "zz-test Ana Pérez", email: `zz-test-ds7-${Date.now()}@example.test` }).select("id").single();
  const { data: tpl, error: tplError } = await raw
    .from("design_templates")
    .insert({
      workspace_id: t.id,
      name: "zz-test Constancia",
      format: "a4_h",
      doc: certificateDoc(),
      origin: "blank",
      verify: true,
      doc_type: "constancia",
      custom_vars: [{ key: "nombre_en_el_certificado", label: "Nombre en el certificado", sample: "Ana" }],
    })
    .select("id")
    .single();
  check(!tplError && !!tpl, "la plantilla de prueba se crea", tplError?.message);
  if (!tpl || !contact) return;
  const { data: flow } = await raw.from("flows").insert({ workspace_id: t.id, name: "zz-test Generar constancia", status: "draft", nodes: [], edges: [] }).select("id").single();
  // Otra persona para el caso «respuesta vacía»: la primera ya va a tener una constancia válida (y el paso reutiliza esa).
  const { data: contact2 } = await raw.from("contacts").insert({ workspace_id: t.id, display_name: "zz-test Beto Gómez", email: `zz-test-ds7-b-${Date.now()}@example.test` }).select("id").single();
  const newSession = async (contactId: string = contact.id) => {
    const { data, error } = await raw
      .from("flow_sessions")
      .insert({ flow_id: flow!.id, contact_id: contactId, status: "active", variables: {} })
      .select("id")
      .single();
    if (error) throw new Error(`no pude crear la sesión: ${error.message}`);
    return data.id as string;
  };
  // El formulario de prueba, publicado: «¿Cómo querés que aparezca tu nombre?» (clave `nombre_certificado`).
  const { data: form, error: formError } = await raw
    .from("forms")
    .insert({
      workspace_id: t.id,
      name: "zz-test Certificado y encuesta",
      type: "custom",
      slug: `zz-test-ds7-${Date.now()}`,
      draft_definition: { fields: [{ id: "f-nc", key: "nombre_certificado", type: "short_text", label: "¿Cómo querés que aparezca tu nombre?", required: false }] },
      contact_config: { mode: "create_or_link", update: "fill_empty", map: [] },
      notify_enabled: false,
    })
    .select("id, name, type, slug")
    .single();
  check(!formError && !!form, "el formulario de prueba se crea", formError?.message);
  await raw.rpc("publish_form_version", { p_form_id: form!.id, p_actor: t.owner.id });
  await raw.from("forms").update({ status: "published" }).eq("id", form!.id);
  const { data: current } = await raw.from("forms").select("current_version_id").eq("id", form!.id).single();
  /** Responde el formulario como la persona y arma las variables como el disparador «Formulario enviado». */
  const answerForm = async (answer: string, contactId: string) => {
    const res = await raw.rpc("submit_form_response", {
      p_form_id: form!.id,
      p_version_id: current!.current_version_id,
      p_idempotency_key: randomUUID(),
      p_answers: answer ? { nombre_certificado: { type: "short_text", value: answer } } : {},
      p_attribution: {},
      p_meta: {},
      p_contact_hint: { signed_contact_id: contactId },
      p_extra: {},
    });
    const submissionId = (res.data as { submission_id?: string } | null)?.submission_id;
    check(!res.error && !!submissionId, "la respuesta del formulario se guarda", res.error?.message);
    const { data: sub } = await raw.from("form_submissions").select("id, created_at, contact_id, answers").eq("id", submissionId as string).single();
    check(sub?.contact_id === contactId, "la respuesta queda vinculada a la persona");
    return formVariables({
      form: { id: form!.id, name: form!.name, type: form!.type, slug: form!.slug },
      submission: { id: sub!.id as string, created_at: sub!.created_at as string, score: null, nps_category: null, contact_created: false, answers: (sub!.answers ?? {}) as Record<string, { value?: unknown }> },
      fieldKeys: ["nombre_certificado"],
      baseUrl: "https://app.ejemplo.test",
      publicBaseUrl: "https://app.ejemplo.test",
    });
  };

  const context = (formVars: ReturnType<typeof formVariables>, contactId: string = contact.id): FlowExecutionContext => ({
    triggerId: "zz-test",
    flowId: flow!.id,
    channelId: "",
    contactId,
    memberUserId: null,
    conversationId: "",
    workspaceId: t.id,
    incomingMessage: {} as FlowExecutionContext["incomingMessage"],
    variables: { ...formVars, contact: { first_name: "Ana", display_name: "zz-test Ana Pérez" } } as unknown as FlowExecutionContext["variables"],
  });
  const data = { templateId: tpl.id, mappings: { nombre_en_el_certificado: { mode: "variable", path: "answer.nombre_certificado" } } };
  const node = { id: "step-1", type: "action", position: { x: 0, y: 0 }, data };

  // ─── Con el dato del formulario (F57, F58) ───────────────────────────────
  console.log("\n— Con el dato del formulario —");
  const okSession = await newSession();
  const okCtx = context(await answerForm("Ana María Pérez", contact.id));
  const notes: Array<{ status: string; reason?: unknown }> = [];
  okCtx.noteStep = (n) => notes.push(n);
  const out = await runDesignGenerate({ supabase: svc, node, data, context: okCtx as never, sessionId: okSession, runtime: { executeFlow: async () => {} } } as never);
  check(out === undefined, "el paso sigue al siguiente", JSON.stringify({ out, notes }));
  const outputs = (okCtx.variables as { design?: Record<string, string> }).design;
  check(!!outputs?.id, "deja design.id");
  const { data: gen } = await raw.from("designs").select("id, code, values, status, source, source_ref, template_id, subject_contact_id, renders").eq("id", outputs?.id ?? "").maybeSingle();
  check((gen?.values as Record<string, string> | undefined)?.nombre_en_el_certificado === "Ana María Pérez", "la generación tiene el nombre de la respuesta", JSON.stringify(gen?.values));
  check(gen?.status === "ready", "con el render simulado, queda lista", String(gen?.status));
  check(gen?.source === "automation" && (gen?.source_ref as { session_id?: string } | null)?.session_id === okSession, "origen: automatización, con la sesión de la corrida", JSON.stringify(gen?.source_ref));
  check(gen?.template_id === tpl.id && gen?.subject_contact_id === contact.id, "de esta plantilla y para el contacto del disparador");
  check(outputs?.code === gen?.code && /\/d\/[0-9A-Z-]+$/.test(outputs?.link ?? "") && (outputs?.pdf_url ?? "").endsWith("/descargar?formato=pdf"), "design.code, design.link y design.pdf_url coinciden con la generación", JSON.stringify(outputs));
  check(outputs?.status === "ready" && outputs?.doc_type === "Constancia", "design.status y design.doc_type", JSON.stringify(outputs));
  const pages = ((gen?.renders as { pages?: string[]; pdf_path?: string } | null)?.pages ?? []).concat((gen?.renders as { pdf_path?: string } | null)?.pdf_path ?? []);
  for (const path of pages) ctx.storagePaths.push({ bucket: "design-renders", path });

  // ─── «Enviar email» con el PDF (F59) ────────────────────────────────────
  console.log("\n— Enviar email con el PDF —");
  const loaded = await loadEmailAttachments(svc, { workspaceId: t.id, refs: [{ kind: "design", from: "design" }], designId: outputs?.id ?? null });
  check(loaded.files.length === 1 && loaded.files[0].filename.endsWith(".pdf") && !loaded.designProblem, "la carga encuentra la generación de la corrida y adjunta su PDF", JSON.stringify({ n: loaded.files.length, p: loaded.designProblem }));
  const none = await loadEmailAttachments(svc, { workspaceId: t.id, refs: [{ kind: "design", from: "design" }], designId: null });
  check(none.designProblem === "missing", "sin generación en la corrida: «No hay un diseño generado en esta automatización»");
  const other = await loadEmailAttachments(svc, { workspaceId: "00000000-0000-4000-8000-000000000000", refs: [{ kind: "design", from: "design" }], designId: outputs?.id ?? null });
  check(other.designProblem === "missing", "la generación de otro negocio no se adjunta");

  // ─── Respuesta vacía y «No generar» (F55, F57) ──────────────────────────
  console.log("\n— Respuesta vacía y «No generar» —");
  const failSession = await newSession(contact2!.id);
  const failCtx = context(await answerForm("", contact2!.id), contact2!.id);
  const failNotes: Array<{ status: string; reason?: unknown }> = [];
  failCtx.noteStep = (n) => failNotes.push(n);
  const failOut = await runDesignGenerate({ supabase: svc, node, data, context: failCtx as never, sessionId: failSession, runtime: { executeFlow: async () => {} } } as never);
  check(failOut === DESIGN_STOP_HANDLE, "el camino termina", String(failOut));
  check(failNotes.some((n) => n.status === "failed" && String(n.reason).startsWith("Falta:")), "con el error «Falta: …»", JSON.stringify(failNotes));
  const { data: failed } = await raw.from("designs").select("status, error").eq("workspace_id", t.id).eq("status", "failed");
  check((failed ?? []).length === 1, "y la generación queda failed (nunca un certificado vacío)", JSON.stringify(failed));

  // ─── «Automatizar» (F60) ────────────────────────────────────────────────
  console.log("\n— Automatizar desde la plantilla —");
  const graph = designFlowTemplate({ id: tpl.id, name: "zz-test Constancia", docNoun: "constancia" });
  const problems = [...triggerProblems(graph.nodes, graph.edges), ...configProblems(graph.nodes, graph.edges)];
  check(JSON.stringify(problems) === JSON.stringify([FORM_NOT_CHOSEN_PROBLEM]), "el borrador pasa la validación salvo el formulario", JSON.stringify(problems));
}
