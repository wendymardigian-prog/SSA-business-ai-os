/**
 * El núcleo que crea UNA generación desde una plantilla, sin sesión (DS6, F50–F56).
 *
 * Lo usan las Server Actions de `lib/actions/designer/generate.ts` (después de chequear `designer.generate` y con el
 * workspace de la SESIÓN), el job `design_generate_many` y el nodo de automatizaciones `designGenerate` (DS7). Recibe
 * el cliente de servicio: quien llama ya decidió el permiso y el workspace.
 *
 * Qué hace, en orden:
 *   1. lee la plantilla y el contacto del negocio (un id de otro negocio no existe);
 *   2. si la plantilla verifica y la persona ya tiene una pieza válida: devuelve `existing`, o con `replaceExisting`
 *      anula la anterior («Reemplazado por <código>») cuando la nueva queda armada;
 *   3. resuelve los valores (`resolveValues`: lo que se pasa, el sujeto, el valor por defecto y la política si falta
 *      un dato, F55) con la fecha de emisión en la zona del NEGOCIO (F56);
 *   4. crea la fila de `designs` con una COPIA CONGELADA del documento de la plantilla (F52): editar la plantilla
 *      después no cambia lo emitido;
 *   5. si faltó un dato con la política `fail`, la fila queda `failed` con «Falta: …» y avisa en la campana a quien
 *      tenga `designer.generate`; si no, queda `queued` y se encola el render (`purpose: "generation"`), salvo con
 *      `enqueueRender: false` (lo corre quien llama);
 *   6. si se pidió, publica con link por el único camino (`publishDesignCore`).
 *
 * El código (`design.code`) lo asigna la base al insertar (F56). Se completa en `values` después; mientras tanto el
 * render lo pone solo desde la fila, así que el del PDF es siempre el del link.
 *
 * NUNCA lanza: un error de la base o del render vuelve como `{ ok: false, reason: "error", retryable }`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { createNotificationOnce } from "@/lib/notifications/create";
import type { Database, Json } from "@/lib/types/database";
import type { MissingPolicy } from "./contracts";
import { docVariables, parseDesignDoc } from "./doc/schema";
import { resolveRegisteredValues, type SubjectRef } from "./extensions";
import { enqueueDesignRender } from "./jobs/render";
import { publishDesignCore } from "./publishing";
import { parseCustomVarsList } from "./variables/custom";
import { isMissingPolicy, missingMessage, resolveValues, type ResolveContact } from "./variables/resolve";
import { docTypeNoun, isDocType } from "./verification";
import type { DateFormat } from "./variables/catalog";

type Db = SupabaseClient<Database>;

export type GenerationSource = "manual" | "bulk" | "automation" | "module";

/**
 * Lo que se guarda en `designs.source_ref` (jsonb): de dónde salió la generación. La pestaña Generaciones arma con esto
 * "A mano · <persona>", "Automatización «<nombre>»" (con link a la corrida), "Para varios" o el módulo.
 */
export type GenerationSourceRef =
  | { kind: "user"; user_id: string }
  | { kind: "automation"; flow_id: string; session_id: string; node_id: string }
  | { kind: "bulk"; batch_id: string; user_id: string | null }
  | { kind: "module"; module: string; id: string };

export interface CreateGenerationInput {
  workspaceId: string;
  templateId: string;
  contactId: string | null;
  subjectRef?: { module: string; type: string; id: string; label: string } | null;
  /** Lo que se pasa a mano o desde la automatización (gana sobre el sujeto y el valor por defecto). */
  overrides: Record<string, string>;
  /** Si falta un dato (F55). En automatizaciones, `fail` por defecto. */
  policy: MissingPolicy;
  publish: boolean;
  source: GenerationSource;
  /** De dónde salió (va a `designs.source_ref`). Su `kind` acompaña a `source`. */
  sourceRef: GenerationSourceRef | null;
  /** Si ya tiene una válida y la plantilla verifica: true = anular la anterior y generar otra; false = devolver `existing`. */
  replaceExisting?: boolean;
  /** Quien la pidió (para el historial); null si es automática. */
  actorUserId: string | null;
  /**
   * `true` (por defecto): encola el render (`design_render`, `purpose: "generation"`). `false`: NO lo encola, porque
   * quien llama lo corre en el momento (el nodo de automatizaciones con "Esperar el PDF antes de seguir", F57) y una
   * segunda corrida en la cola renderizaría dos veces.
   */
  enqueueRender?: boolean;
  /**
   * El email que se manda al quedar lista («Mandar por email», F50/F51). Se guarda en `source_ref.email_request` y lo
   * manda `lib/designer/generation-email.ts` cuando la pieza pasa a `ready`. Omitido: no se manda nada (el nodo de
   * automatizaciones tiene su propio paso «Enviar email»).
   */
  email?: { subject: string; body: string } | null;
}

export type CreateGenerationResult =
  | {
      ok: true;
      designId: string;
      code: string;
      /** `queued`: el render quedó encolado. `failed`: faltó un dato con la política `fail` (la fila queda con el motivo). */
      status: "queued" | "failed";
      missing: { key: string; label: string }[];
    }
  | { ok: false; reason: "existing"; existing: { designId: string; code: string } }
  | { ok: false; reason: "error"; error: string; retryable: boolean };

/** Los estados de una pieza «válida»: la que ya está lista o va a estarlo. Una fallida o anulada no cuenta. */
export const VALID_STATUSES = ["queued", "rendering", "ready"] as const;

/** Lo que se inyecta en los tests: nada de render, avisos ni historial de verdad. */
export interface GenerationDeps {
  now?: () => Date;
  enqueue?: typeof enqueueDesignRender;
  publish?: typeof publishDesignCore;
  notify?: typeof createNotificationOnce;
  audit?: typeof logAudit;
  registered?: typeof resolveRegisteredValues;
}

const TEMPLATE_COLUMNS = "id, name, format, doc, custom_vars, date_format, verify, doc_type, doc_type_label, allow_download, archived_at";

interface TemplateRow {
  id: string;
  name: string;
  format: string;
  doc: Json;
  custom_vars: Json;
  date_format: string;
  verify: boolean;
  doc_type: string | null;
  doc_type_label: string | null;
  allow_download: boolean;
  archived_at: string | null;
}

const fail = (error: string, retryable = false): CreateGenerationResult => ({ ok: false, reason: "error", error, retryable });

const dateFormatOf = (value: string): DateFormat => (value === "short" || value === "en" ? value : "long");

/** El nombre de la pieza: «Certificado · Ana Pérez» (hasta 200 caracteres, como pide la base). */
export function generationName(templateName: string, subjectLabel: string | null): string {
  const base = templateName.trim() || "Pieza";
  const label = (subjectLabel ?? "").trim();
  return (label ? `${base} · ${label}` : base).slice(0, 200);
}

/** El sustantivo del aviso («constancia», «certificado» o «pieza» si la plantilla no verifica). */
function nounOf(template: Pick<TemplateRow, "verify" | "doc_type" | "doc_type_label">): string {
  return template.verify && isDocType(template.doc_type) ? docTypeNoun(template.doc_type, template.doc_type_label).toLowerCase() : "pieza";
}

interface ExistingRow {
  id: string;
  code: string;
  status: string;
  created_at: string;
}

/** Las piezas válidas que ya tiene una persona (o un registro de un módulo) de esta plantilla, las más recientes primero. */
async function validOf(db: Db, workspaceId: string, templateId: string, subject: { contactId: string | null; subjectRef: SubjectRef | null }): Promise<ExistingRow[] | "error"> {
  if (!subject.contactId && !subject.subjectRef) return [];
  let query = db.from("designs").select("id, code, status, created_at").eq("workspace_id", workspaceId).eq("template_id", templateId).in("status", [...VALID_STATUSES]);
  query = subject.subjectRef
    ? query.eq("subject_ref->>module", subject.subjectRef.module).eq("subject_ref->>id", subject.subjectRef.id)
    : query.eq("subject_contact_id", subject.contactId as string);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(20);
  if (error) {
    console.error("[designer] no pude buscar las piezas válidas:", error.message);
    return "error";
  }
  return (data ?? []) as unknown as ExistingRow[];
}

/**
 * Las piezas válidas de VARIAS personas de una plantilla (contacto → la más reciente). Es lo que usan «Saltear a quienes
 * ya tienen uno válido» al contar y al generar. Lanza si la base falla: un error nunca se toma como «no tiene».
 */
export async function findValidForContacts(db: Db, workspaceId: string, templateId: string, contactIds: readonly string[]): Promise<Map<string, { designId: string; code: string }>> {
  const out = new Map<string, { designId: string; code: string }>();
  for (let i = 0; i < contactIds.length; i += 150) {
    const { data, error } = await db
      .from("designs")
      .select("id, code, subject_contact_id, created_at")
      .eq("workspace_id", workspaceId)
      .eq("template_id", templateId)
      .in("status", [...VALID_STATUSES])
      .in("subject_contact_id", contactIds.slice(i, i + 150))
      .order("created_at", { ascending: false });
    if (error) throw new Error(`No pude buscar las piezas válidas: ${error.message}`);
    for (const row of (data ?? []) as unknown as { id: string; code: string; subject_contact_id: string }[]) {
      if (!out.has(row.subject_contact_id)) out.set(row.subject_contact_id, { designId: row.id, code: row.code });
    }
  }
  return out;
}

export async function createGeneration(db: Db, input: CreateGenerationInput, depsIn: GenerationDeps = {}): Promise<CreateGenerationResult> {
  const deps: Required<GenerationDeps> = {
    now: depsIn.now ?? (() => new Date()),
    enqueue: depsIn.enqueue ?? enqueueDesignRender,
    publish: depsIn.publish ?? publishDesignCore,
    notify: depsIn.notify ?? createNotificationOnce,
    audit: depsIn.audit ?? logAudit,
    registered: depsIn.registered ?? resolveRegisteredValues,
  };
  try {
    return await run(db, input, deps);
  } catch (error) {
    console.error("[designer] createGeneration falló:", error instanceof Error ? error.message : "error");
    return fail("No se pudo generar la pieza. Probá de nuevo.", true);
  }
}

async function run(db: Db, input: CreateGenerationInput, deps: Required<GenerationDeps>): Promise<CreateGenerationResult> {
  const { workspaceId, templateId } = input;
  if (!workspaceId || !templateId) return fail("Falta la plantilla.");
  const policy: MissingPolicy = isMissingPolicy(input.policy) ? input.policy : "fail";
  const subjectRef: SubjectRef | null = input.subjectRef ?? null;

  // 1. La plantilla y el sujeto, siempre del negocio de quien llama.
  const { data: tpl, error: tplError } = await db.from("design_templates").select(TEMPLATE_COLUMNS).eq("id", templateId).eq("workspace_id", workspaceId).maybeSingle();
  if (tplError) {
    console.error("[designer] no pude leer la plantilla:", tplError.message);
    return fail("No se pudo leer la plantilla.", true);
  }
  if (!tpl) return fail("La plantilla ya no existe.");
  const template = tpl as unknown as TemplateRow;
  if (template.archived_at) return fail("La plantilla está archivada: restaurala para generar piezas.");
  const parsed = parseDesignDoc(template.doc);
  if (!parsed.ok) return fail("El documento de la plantilla no es válido.");

  let contact: (ResolveContact & { id: string }) | null = null;
  if (input.contactId) {
    const { data, error } = await db.from("contacts").select("id, display_name, email, phone").eq("id", input.contactId).eq("workspace_id", workspaceId).is("deleted_at", null).maybeSingle();
    if (error) {
      console.error("[designer] no pude leer el contacto:", error.message);
      return fail("No se pudo leer el contacto.", true);
    }
    if (!data) return fail("El contacto ya no existe.");
    contact = data as unknown as ResolveContact & { id: string };
  }

  const { data: ws, error: wsError } = await db.from("workspaces").select("name, brand_name, timezone").eq("id", workspaceId).maybeSingle();
  if (wsError || !ws) {
    if (wsError) console.error("[designer] no pude leer el negocio:", wsError.message);
    return fail("No se pudo leer el negocio.", true);
  }
  const workspace = ws as { name: string | null; brand_name: string | null; timezone: string | null };

  // 2. ¿Ya tiene una válida? (solo las plantillas con verificación: una sola por persona).
  let replaced: ExistingRow[] = [];
  if (template.verify) {
    const valid = await validOf(db, workspaceId, templateId, { contactId: input.contactId, subjectRef });
    if (valid === "error") return fail("No se pudo revisar si ya tiene una pieza válida.", true);
    if (valid.length > 0) {
      const ready = valid.find((v) => v.status === "ready") ?? valid[0];
      if (!input.replaceExisting) return { ok: false, reason: "existing", existing: { designId: ready.id, code: ready.code } };
      // Una pieza que se está armando no se puede reemplazar: al terminar de armarse volvería a quedar «lista».
      if (valid.some((v) => v.status !== "ready")) return fail("Ya hay una pieza en preparación para esta persona. Esperá a que termine para reemplazarla.");
      replaced = valid;
    }
  }

  // 3. Los valores.
  const registered = await deps.registered({ workspaceId, subject: subjectRef, contactId: input.contactId });
  const now = deps.now();
  const resolved = resolveValues(
    {
      docKeys: docVariables(parsed.doc),
      customVars: parseCustomVarsList(template.custom_vars),
      dateFormat: dateFormatOf(template.date_format),
      verify: template.verify,
      docType: template.doc_type,
      docTypeLabel: template.doc_type_label,
    },
    { contact, workspaceName: workspace.brand_name || workspace.name, registered, now, timeZone: workspace.timezone || "UTC" },
    input.overrides ?? {},
    policy,
  );
  // El código lo asigna la base: un «código vacío» guardado taparía al que el render pone solo desde la fila.
  const values = { ...resolved.values };
  delete values["design.code"];

  const failed = !resolved.ok;
  const subjectLabel = contact?.display_name?.trim() || subjectRef?.label || null;

  // 4. La fila: una copia CONGELADA del documento (F52).
  const sourceRef: Record<string, unknown> | null = input.sourceRef || input.email ? { ...(input.sourceRef ?? {}), ...(input.email ? { email_request: { subject: input.email.subject, body: input.email.body } } : {}) } : null;
  const { data: created, error: insertError } = await db
    .from("designs")
    .insert({
      workspace_id: workspaceId,
      name: generationName(template.name, subjectLabel),
      format: template.format as never,
      // Copia congelada: una copia propia del documento, nunca el mismo objeto que la plantilla.
      doc: structuredClone(template.doc),
      rev: 0,
      origin: "template",
      template_id: templateId,
      subject_contact_id: input.contactId,
      subject_ref: subjectRef as unknown as Json,
      values: values as unknown as Json,
      status: failed ? "failed" : "queued",
      error: failed ? missingMessage(resolved.missing) : null,
      attempts: 0,
      source: input.source,
      source_ref: sourceRef as unknown as Json,
      allow_download: template.allow_download,
      published: false,
      created_by: input.actorUserId,
    })
    .select("id, code")
    .single();
  if (insertError || !created) {
    console.error("[designer] no pude crear la generación:", insertError?.message ?? "sin fila");
    return fail("No se pudo crear la pieza. Probá de nuevo.", true);
  }
  const designId = (created as { id: string }).id;
  const code = (created as { code: string }).code;

  // El código en los valores (para «Detalle» y el email). No frena nada si falla: el render lo pone solo.
  const withCode = { ...values, "design.code": code };
  const { error: codeError } = await db.from("designs").update({ values: withCode as unknown as Json }).eq("id", designId);
  if (codeError) console.error("[designer] no pude guardar el código en los valores:", codeError.message);

  await safely("audit", () =>
    deps.audit({
      supabase: db as unknown as SupabaseClient,
      workspaceId,
      entityType: "design",
      entityId: designId,
      action: "design.generated",
      changes: null,
      metadata: { event: "design.generated", template_id: templateId, source: input.source, status: failed ? "failed" : "queued", format: template.format },
      performedBy: input.actorUserId,
    }),
  );

  // 5. Reemplazar: la anterior se anula recién cuando la nueva quedó armada (una nueva fallida no deja a la persona sin nada).
  if (!failed && replaced.length > 0) {
    for (const old of replaced) {
      const reason = `Reemplazado por ${code}`;
      const { data: voided, error: voidError } = await db
        .from("designs")
        .update({ status: "void", void_reason: reason, voided_at: now.toISOString(), voided_by: input.actorUserId })
        .eq("id", old.id)
        .eq("workspace_id", workspaceId)
        .eq("status", "ready")
        .select("id");
      if (voidError) console.error("[designer] no pude anular la pieza anterior:", voidError.message);
      else if (voided && voided.length > 0) {
        await safely("audit", () =>
          deps.audit({
            supabase: db as unknown as SupabaseClient,
            workspaceId,
            entityType: "design",
            entityId: old.id,
            action: "design.voided",
            changes: { status: { old: "ready", new: "void" }, void_reason: { old: null, new: reason } },
            metadata: { event: "design.voided", kind: "generation", replaced_by: code },
            performedBy: input.actorUserId,
          }),
        );
      }
    }
  }

  // 6. Publicar con link: por el único camino. La falla de publicar no deshace la pieza.
  if (input.publish) {
    await safely("publish", async () => {
      const out = await deps.publish(db, { workspaceId, userId: input.actorUserId as string }, { designId });
      if (!out.ok) console.error("[designer] no pude publicar la generación:", out.error);
    });
  }

  if (failed) {
    await safely("notify", () =>
      deps.notify({
        supabase: db,
        workspaceId,
        type: "design_generation_failed",
        title: `No se generó ${nounOf(template) === "pieza" ? "una pieza" : `un ${nounOf(template)}`} de «${template.name}»`,
        body: `${missingMessage(resolved.missing)}${subjectLabel ? ` (para ${subjectLabel})` : ""}. Completalo desde Generaciones → Reintentar.`,
        entityType: "design_template",
        entityId: templateId,
        metadata: { design_id: designId, template_id: templateId, reason: "missing_data" },
        withinMinutes: 30,
      }),
    );
    return { ok: true, designId, code, status: "failed", missing: resolved.missing };
  }

  // 7. El render va a la cola, salvo que quien llama lo corra en el momento.
  if (input.enqueueRender !== false) {
    try {
      await deps.enqueue(db, { designId, purpose: "generation" });
    } catch (error) {
      console.error("[designer] no pude encolar el render de la generación:", error instanceof Error ? error.message : "error");
      const message = "No se pudo preparar el archivo. Tocá «Reintentar» para armarlo de nuevo.";
      await db.from("designs").update({ status: "failed", error: message }).eq("id", designId);
      return { ok: true, designId, code, status: "failed", missing: [] };
    }
  }
  return { ok: true, designId, code, status: "queued", missing: [] };
}

/** Un paso accesorio (historial, aviso, publicar) que nunca tumba la generación. */
async function safely(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(`[designer] ${what} de la generación falló:`, error instanceof Error ? error.message : "error");
  }
}
