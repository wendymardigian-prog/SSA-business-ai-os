/**
 * El email de una generación (F50, F51, F54): «Mandar por email» al emitir y «Mandar el email ahora» desde el detalle.
 *
 * - Sale SIEMPRE por `sendTransactionalEmail` con la categoría `transactional`: pasa la puerta de suscripción (un
 *   contacto que rebota no recibe nada; uno dado de baja de marketing sí recibe su certificado).
 * - El asunto y el cuerpo llevan variables (`{{design.link}}`, `{{contact.first_name|}}`, las propias de la plantilla…).
 *   `{{design.link}}` y `{{design.pdf_url}}` se arman con el dominio del NEGOCIO (`loadDesignLinks`): nunca con el del
 *   navegador ni con el principal.
 * - Lo que pidió la persona al emitir («Mandar por email») queda en `designs.source_ref.email_request` y se manda cuando
 *   la pieza pasa a `ready` (`registerGenerationEmail` se suscribe a `onDesignGenerated`). Reintentar un render NO manda
 *   el email de nuevo si ya salió, y reintentar NUNCA vuelve a correr una automatización.
 * - `designs.email_status`: `sent`, `failed` (no se pudo mandar) o `skipped` (no había a quién o la puerta lo salteó).
 *
 * Nada de esto lanza hacia quien llama: devuelve el resultado en español. Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { dropDanglingComma, plainTextToHtml } from "@/lib/email/html";
import { sendTransactionalEmail, type SendEmailResult } from "@/lib/email/send";
import type { Database, Json } from "@/lib/types/database";
import type { ActionResult } from "./contracts";
import { onDesignGenerated, type GeneratedDesign } from "./extensions";
import { loadDesignLinks } from "./public-links";
import { docTypeNoun, isDocType } from "./verification";

type Db = SupabaseClient<Database>;

export const GENERATION_EMAIL_KIND = "design_generated";
export const MAX_EMAIL_SUBJECT = 200;
export const MAX_EMAIL_BODY = 5000;

export interface EmailRequest {
  subject: string;
  body: string;
}

const VARIABLE = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*(?:\|([^{}]*))?\}\}/g;

/**
 * Pega los valores en un texto. `{{clave}}` sin valor queda vacío; `{{clave|respaldo}}` usa el respaldo. «Hola,
 * {{contact.first_name|}}.» sin nombre queda «Hola.», no «Hola, .» (la misma regla que los demás emails).
 */
export function interpolateGenerationEmail(text: string, values: Readonly<Record<string, string>>): string {
  const rendered = text.replace(VARIABLE, (_m, key: string, fallback: string | undefined) => {
    const value = values[key];
    return typeof value === "string" && value.trim() !== "" ? value : (fallback ?? "").trim();
  });
  return dropDanglingComma(text, rendered);
}

/** El email que se propone al emitir: corto y con el link. `noun` es «certificado», «constancia»… o null («pieza»). */
export function defaultGenerationEmail(noun: string | null): EmailRequest {
  const what = noun ? noun.toLowerCase() : "pieza";
  return {
    subject: `Tu ${what}`,
    body: `Hola {{contact.first_name|}},\n\nAcá está tu ${what}: {{design.link}}\n\nUn saludo.`,
  };
}

/** Lo que pidió la persona al emitir, leído de `source_ref`. Algo que no tiene la forma esperada es «sin email». */
export function parseEmailRequest(sourceRef: unknown): EmailRequest | null {
  if (!sourceRef || typeof sourceRef !== "object" || Array.isArray(sourceRef)) return null;
  const req = (sourceRef as { email_request?: unknown }).email_request;
  if (!req || typeof req !== "object" || Array.isArray(req)) return null;
  const { subject, body } = req as { subject?: unknown; body?: unknown };
  return typeof subject === "string" && typeof body === "string" && subject.trim() && body.trim() ? { subject, body } : null;
}

/** Los problemas de un asunto y un cuerpo escritos a mano (vacío = se puede mandar). */
export function emailProblems(email: { subject: string; body: string }): string | null {
  const subject = email.subject.trim();
  const body = email.body.trim();
  if (!subject) return "Escribí el asunto del email.";
  if (!body) return "Escribí el mensaje del email.";
  if (subject.length > MAX_EMAIL_SUBJECT) return `El asunto es demasiado largo (hasta ${MAX_EMAIL_SUBJECT} caracteres).`;
  if (body.length > MAX_EMAIL_BODY) return `El mensaje es demasiado largo (hasta ${MAX_EMAIL_BODY} caracteres).`;
  return null;
}

export interface GenerationEmailDeps {
  send?: typeof sendTransactionalEmail;
  loadLinks?: typeof loadDesignLinks;
  audit?: typeof logAudit;
}

interface DesignRow {
  id: string;
  workspace_id: string;
  template_id: string | null;
  subject_contact_id: string | null;
  status: string;
  code: string;
  values: Json;
  source_ref: Json;
  email_status: string | null;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

async function markEmail(db: Db, workspaceId: string, designId: string, status: "sent" | "failed" | "skipped"): Promise<void> {
  const { error } = await db.from("designs").update({ email_status: status }).eq("id", designId).eq("workspace_id", workspaceId);
  if (error) console.error("[designer] no pude anotar el estado del email:", error.message);
}

function stringValues(raw: Json): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * Manda el email de una generación lista. Con `subject` y `body` usa esos; si no, lo que pidió la persona al emitir; y si
 * tampoco, el texto de siempre. Nunca lanza. El workspace lo pone quien llama (la sesión, o la fila del aviso).
 */
export async function sendGenerationEmailCore(
  db: Db,
  input: { workspaceId: string; designId: string; userId: string | null; subject?: string; body?: string },
  depsIn: GenerationEmailDeps = {},
): Promise<ActionResult<{ to: string }>> {
  const deps = { send: depsIn.send ?? sendTransactionalEmail, loadLinks: depsIn.loadLinks ?? loadDesignLinks, audit: depsIn.audit ?? logAudit };
  try {
    const { data, error } = await db
      .from("designs")
      .select("id, workspace_id, template_id, subject_contact_id, status, code, values, source_ref, email_status")
      .eq("id", input.designId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (error) {
      console.error("[designer] no pude leer la generación para el email:", error.message);
      return fail("No se pudo leer la pieza. Probá de nuevo.");
    }
    if (!data || !(data as DesignRow).template_id) return fail("No encontramos esa pieza.");
    const row = data as unknown as DesignRow;
    if (row.status === "void") return fail("Una pieza anulada no se manda por email.");
    if (row.status !== "ready") return fail("La pieza todavía no está lista: esperá a que termine para mandarla.");
    if (row.email_status === "sent") return fail("El email de esta pieza ya se mandó.");

    const { data: tpl } = await db.from("design_templates").select("verify, doc_type, doc_type_label").eq("id", row.template_id as string).eq("workspace_id", input.workspaceId).maybeSingle();
    const template = tpl as { verify: boolean; doc_type: string | null; doc_type_label: string | null } | null;
    const noun = template?.verify && isDocType(template.doc_type) ? docTypeNoun(template.doc_type, template.doc_type_label) : null;

    const asked = input.subject !== undefined || input.body !== undefined ? { subject: input.subject ?? "", body: input.body ?? "" } : (parseEmailRequest(row.source_ref) ?? defaultGenerationEmail(noun));
    const problem = emailProblems(asked);
    if (problem) return fail(problem);

    if (!row.subject_contact_id) {
      await markEmail(db, input.workspaceId, row.id, "skipped");
      return fail("Esta pieza no tiene a quién mandarle el email.");
    }
    const { data: contact } = await db.from("contacts").select("id, email").eq("id", row.subject_contact_id).eq("workspace_id", input.workspaceId).is("deleted_at", null).maybeSingle();
    const to = (contact as { email: string | null } | null)?.email?.trim();
    if (!to) {
      await markEmail(db, input.workspaceId, row.id, "skipped");
      return fail("El contacto no tiene email: la pieza está lista pero el email no salió.");
    }

    const links = await deps.loadLinks(db, input.workspaceId, row.code);
    const values = { ...stringValues(row.values), "design.link": links.link, "design.pdf_url": links.pdfUrl, "design.code": row.code };
    const subject = interpolateGenerationEmail(asked.subject, values).replace(/\s+/g, " ").trim();
    const html = plainTextToHtml(interpolateGenerationEmail(asked.body, values));

    const result: SendEmailResult = await deps.send({
      workspaceId: input.workspaceId,
      to,
      subject,
      html,
      kind: GENERATION_EMAIL_KIND,
      relatedEntityType: "design",
      relatedEntityId: row.id,
      contactId: row.subject_contact_id,
      createdBy: input.userId,
      category: "transactional",
    });

    if (result.ok) {
      await markEmail(db, input.workspaceId, row.id, "sent");
      try {
        await deps.audit({
          supabase: db as unknown as SupabaseClient,
          workspaceId: input.workspaceId,
          entityType: "design",
          entityId: row.id,
          action: "design.email_sent",
          changes: null,
          metadata: { event: "design.email_sent", template_id: row.template_id },
          performedBy: input.userId,
        });
      } catch (auditError) {
        console.error("[designer] no pude anotar el email en el historial:", auditError instanceof Error ? auditError.message : "error");
      }
      return { ok: true, data: { to } };
    }
    if (result.reason === "skipped") {
      await markEmail(db, input.workspaceId, row.id, "skipped");
      return fail("Ese email no se puede mandar: la dirección del contacto no puede recibirlo.");
    }
    await markEmail(db, input.workspaceId, row.id, "failed");
    if (result.reason === "not_configured") return fail("No hay un email conectado: conectá Resend en Integraciones para mandar piezas por email.");
    if (result.reason === "deferred") return fail("El email se mandará más tarde: hoy se alcanzó el máximo de envíos.");
    return fail("No se pudo mandar el email. Probá de nuevo en un rato.");
  } catch (error) {
    console.error("[designer] el email de la generación falló:", error instanceof Error ? error.message : "error");
    return fail("No se pudo mandar el email. Probá de nuevo en un rato.");
  }
}

/**
 * Cuando una pieza queda lista, manda el email que se pidió al emitirla (y no otro). Solo si lo pidieron y todavía no salió.
 * Nunca lanza: un email que falla no deshace una pieza que ya está lista.
 */
export async function handleDesignGenerated(db: Db, design: GeneratedDesign, deps: GenerationEmailDeps = {}): Promise<void> {
  try {
    const { data } = await db.from("designs").select("source_ref, email_status").eq("id", design.designId).eq("workspace_id", design.workspaceId).maybeSingle();
    const row = data as { source_ref: Json; email_status: string | null } | null;
    if (!row || row.email_status !== null || !parseEmailRequest(row.source_ref)) return;
    const created = (row.source_ref as { user_id?: unknown } | null)?.user_id;
    await sendGenerationEmailCore(db, { workspaceId: design.workspaceId, designId: design.designId, userId: typeof created === "string" ? created : null }, deps);
  } catch (error) {
    console.error("[designer] el aviso de pieza lista falló:", error instanceof Error ? error.message : "error");
  }
}

let registered = false;

/**
 * Se suscribe, una vez por proceso, a las piezas que quedan listas. Lo llama `lib/designer/jobs/generate-many.ts`, que ya
 * está en el camino de los jobs del Diseñador IA: así el proceso que renderiza es el que manda el email.
 */
export function registerGenerationEmail(): void {
  if (registered) return;
  registered = true;
  onDesignGenerated(async (design) => {
    // Import diferido: `lib/supabase/server` trae `next/headers`, que no va en un import de módulo suelto.
    const { createServiceClient } = await import("@/lib/supabase/server");
    await handleDesignGenerated((await createServiceClient()) as Db, design);
  });
}
