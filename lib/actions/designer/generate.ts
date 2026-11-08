"use server";

/**
 * Generar desde plantilla (DS6, F50–F56): para uno, para varios, reintentar, volver a generar y mandar el email.
 * Piden `designer.generate`.
 *
 * Cada acción valida su permiso adentro (`getPermissionAction`), revisa la forma de lo que manda el navegador y escribe con
 * el cliente de servicio filtrando por el negocio de la SESIÓN (nunca el que mande el navegador). La lógica está en
 * `lib/designer/generate-ops.ts`, `bulk-core.ts` y `generation-email.ts`, que se prueban sin la base.
 *
 * En un archivo "use server" todo lo exportado es una función asincrónica: los tipos viven en los módulos de la lógica.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import type { ActionResult, GenerateManyInput, GenerateOneInput, GenerationPreview } from "@/lib/designer/contracts";
import { countGenerationAudienceCore, generateManyCore, type AudienceCount } from "@/lib/designer/bulk-core";
import { generateOneCore, previewGenerationCore, regenerateCore, retryFailedGenerationsCore, retryGenerationCore, type GeneratedPiece } from "@/lib/designer/generate-ops";
import { sendGenerationEmailCore } from "@/lib/designer/generation-email";

const NO_PERMISSION = "No tenés permiso para generar piezas.";
const BAD_REQUEST = "El pedido no es válido.";

const uuid = z.string().uuid();
const email = z.object({ subject: z.string().max(400), body: z.string().max(10_000) });
const overrides = z.record(z.string().max(80), z.string().max(2_000)).refine((o) => Object.keys(o).length <= 200);

/** La persona y el negocio salen de la sesión; nunca de lo que mande el navegador. */
async function generateScope() {
  const ctx = await getPermissionAction("designer.generate");
  if (!ctx) return null;
  const service = await createServiceClient();
  return { ctx, service, env: { service, workspaceId: ctx.workspace.id, userId: ctx.user.id } };
}

/**
 * El alcance de leads: generar para una persona (y ver sus datos en la vista previa) exige que quien genera pueda VER ese
 * contacto con su sesión (la RLS de `contacts` decide). El núcleo lee con el cliente de servicio, así que se mira acá.
 */
const CONTACT_NOT_VISIBLE = "No encontramos ese contacto.";
async function canSeeContact(scope: NonNullable<Awaited<ReturnType<typeof generateScope>>>, contactId: string | null): Promise<boolean> {
  if (!contactId) return true;
  const { data, error } = await scope.ctx.supabase.from("contacts").select("id").eq("id", contactId).eq("workspace_id", scope.ctx.workspace.id).maybeSingle();
  // Un error de lectura nunca abre.
  return !error && !!data;
}

export async function previewGeneration(input: { templateId: string; contactId: string | null; overrides: Record<string, string> }): Promise<ActionResult<GenerationPreview>> {
  const scope = await generateScope();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ templateId: uuid, contactId: uuid.nullable(), overrides }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  if (!(await canSeeContact(scope, parsed.data.contactId))) return { ok: false, error: CONTACT_NOT_VISIBLE };
  return previewGenerationCore(scope.env, parsed.data);
}

export async function generateOne(input: GenerateOneInput): Promise<ActionResult<GeneratedPiece>> {
  const scope = await generateScope();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const parsed = z
    .object({
      templateId: uuid,
      contactId: uuid.nullable(),
      subjectRef: z.object({ module: z.string().max(40), type: z.string().max(40), id: z.string().max(120), label: z.string().max(200) }).nullable().optional(),
      overrides,
      publish: z.boolean(),
      email: email.nullable().optional(),
      replaceExisting: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  if (!(await canSeeContact(scope, parsed.data.contactId))) return { ok: false, error: CONTACT_NOT_VISIBLE };
  const result = await generateOneCore(scope.env, parsed.data);
  if (result.ok) revalidatePath(`/dashboard/disenos/t/${parsed.data.templateId}`);
  return result;
}

export async function countGenerationAudience(input: Omit<GenerateManyInput, "publish" | "email">): Promise<ActionResult<AudienceCount>> {
  const scope = await generateScope();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ templateId: uuid, audienceParams: z.string().max(4000), skipExisting: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  const { ctx, service } = scope;
  return countGenerationAudienceCore({ service, user: ctx.supabase, workspaceId: ctx.workspace.id, userId: ctx.user.id, timeZone: await resolveViewerTimezone(ctx.workspace.timezone) }, parsed.data);
}

export async function generateMany(input: GenerateManyInput): Promise<ActionResult<{ queued: number }>> {
  const scope = await generateScope();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ templateId: uuid, audienceParams: z.string().max(4000), skipExisting: z.boolean(), publish: z.boolean(), email: email.nullable().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  const { ctx, service } = scope;
  const result = await generateManyCore({ service, user: ctx.supabase, workspaceId: ctx.workspace.id, userId: ctx.user.id, timeZone: await resolveViewerTimezone(ctx.workspace.timezone) }, parsed.data);
  if (result.ok) revalidatePath(`/dashboard/disenos/t/${parsed.data.templateId}`);
  return result;
}

/** Reintentar (F54): un render fallido se vuelve a renderizar; una falla de datos pide el dato. */
export async function retryGeneration(input: { designId: string; values?: Record<string, string> }): Promise<ActionResult<{ needs?: { key: string; label: string }[] }>> {
  const scope = await generateScope();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ designId: uuid, values: overrides.optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  return retryGenerationCore(scope.env, parsed.data);
}

/** Reintentar todas las fallidas de una plantilla (las de render; las de datos piden el dato una por una). */
export async function retryFailedGenerations(input: { templateId: string }): Promise<ActionResult<{ retried: number; needData: number }>> {
  const scope = await generateScope();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ templateId: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  return retryFailedGenerationsCore(scope.env, parsed.data);
}

/** Volver a generar (F47): anula la anterior («Reemplazado por <código>») y genera una nueva con los datos de hoy. */
export async function regenerate(input: { designId: string }): Promise<ActionResult<{ designId: string; code: string }>> {
  const scope = await generateScope();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ designId: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  return regenerateCore(scope.env, parsed.data);
}

/** «Mandar el email ahora» (F54): el reintento nunca vuelve a correr la automatización. */
export async function sendGenerationEmail(input: { designId: string; subject?: string; body?: string }): Promise<ActionResult> {
  const scope = await generateScope();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ designId: uuid, subject: z.string().max(400).optional(), body: z.string().max(10_000).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  const result = await sendGenerationEmailCore(scope.service, { workspaceId: scope.ctx.workspace.id, userId: scope.ctx.user.id, ...parsed.data });
  return result.ok ? { ok: true, data: undefined } : result;
}
