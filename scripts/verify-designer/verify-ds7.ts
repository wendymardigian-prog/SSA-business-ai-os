/**
 * verify-designer · bloque ds7 (F57–F60): el paso «Generar desde plantilla» de punta a punta, contra la base real y con
 * el render simulado (`DESIGNER_FAKE_RENDER=1`, lo pone `verify-designer.mjs`).
 *
 * - Una corrida simulada de un flujo de «Formulario enviado» con la respuesta `nombre_certificado`: la generación queda
 *   con ese nombre en `values`, origen `automation` con la sesión, lista (render simulado) y las seis salidas.
 * - Con la respuesta vacía y «No generar»: el camino termina con el error y la generación queda `failed`.
 * - «Enviar email» con el PDF: la carga encuentra la generación de la corrida y su PDF.
 * - «Automatizar» (F60): el borrador pasa la validación salvo el formulario.
 */

import { runDesignGenerate } from "../../lib/flow-engine/nodes/design-generate";
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
          { id: "el_test0001", type: "text", x: 50, y: 40, w: 80, h: 12, rotation: 0, text: "Constancia para {{nombre_en_el_certificado}}" },
          { id: "el_test0002", type: "text", x: 50, y: 70, w: 60, h: 8, rotation: 0, text: "Código {{design.code}}" },
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
  const newSession = async () => {
    const { data, error } = await raw
      .from("flow_sessions")
      .insert({ flow_id: flow!.id, workspace_id: t.id, contact_id: contact.id, status: "active", variables: {} })
      .select("id")
      .single();
    if (error) throw new Error(`no pude crear la sesión: ${error.message}`);
    return data.id as string;
  };
  const context = (answer: string): FlowExecutionContext => ({
    triggerId: "zz-test",
    flowId: flow!.id,
    channelId: "",
    contactId: contact.id,
    memberUserId: null,
    conversationId: "",
    workspaceId: t.id,
    incomingMessage: {} as FlowExecutionContext["incomingMessage"],
    variables: { answer: { nombre_certificado: answer }, contact: { first_name: "Ana", display_name: "zz-test Ana Pérez" } } as FlowExecutionContext["variables"],
  });
  const data = { templateId: tpl.id, mappings: { nombre_en_el_certificado: { mode: "variable", path: "answer.nombre_certificado" } } };
  const node = { id: "step-1", type: "action", position: { x: 0, y: 0 }, data };

  // ─── Con el dato del formulario (F57, F58) ───────────────────────────────
  console.log("\n— Con el dato del formulario —");
  const okSession = await newSession();
  const okCtx = context("Ana María Pérez");
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
  const failSession = await newSession();
  const failCtx = context("");
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
