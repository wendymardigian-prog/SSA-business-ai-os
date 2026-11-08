/**
 * Generar para varios (F51), la parte de las acciones: contar a quiénes llega y encolar el job. Solo servidor.
 *
 * La audiencia son los parámetros de URL de Contactos (los MISMOS filtros que la lista y que Broadcasts: etiqueta,
 * segmento, búsqueda…) y se resuelve con el cliente de la PERSONA, así la RLS decide a quiénes ve. Se FIJA al confirmar: el
 * job recibe la lista de contactos (hasta 500), no los filtros. Se cuenta con la misma consulta que se usa para generar:
 * el número que se ve es el que se hace.
 *
 * No hay otra forma de elegir contactos que esa, y nunca se genera para alguien que la persona no ve.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeAudienceParams } from "@/lib/broadcasts/audience-load";
import { loadCustomFieldRefs, prepareContactList, contactListQuery } from "@/lib/contacts/list-load";
import { scheduleJob } from "@/lib/scheduler";
import { firstParam, sanitizeSearch, type SearchParams } from "@/lib/url-params";
import type { Database } from "@/lib/types/database";
import type { ActionResult } from "./contracts";
import { docVariables, parseDesignDoc } from "./doc/schema";
import { findValidForContacts } from "./generate-core";
import { emailProblems } from "./generation-email";
import { DESIGN_GENERATE_MANY_JOB, MAX_GENERATE_MANY, type GenerateManyPayload } from "./jobs/generate-many";
import { blockersMessage } from "./screens/generate-many";
import { parseCustomVarsList, requiredCustomVars } from "./variables/custom";

type Db = SupabaseClient<Database>;

export interface BulkEnv {
  /** El cliente de servicio: lee la plantilla y las piezas del negocio de la SESIÓN. */
  service: Db;
  /** El cliente de la PERSONA: la RLS decide qué contactos ve. */
  user: Db;
  workspaceId: string;
  userId: string;
  /** La zona de quien pide (los filtros por fecha de Contactos). */
  timeZone: string;
}

export interface Audience {
  ids: string[];
  /** Cuántos cumplen en total (puede pasar de lo que se trae). */
  total: number;
}

export interface BulkDeps {
  /** La audiencia (se reemplaza en los tests: el planificador de Contactos habla con la base). */
  audience?: (env: BulkEnv, params: SearchParams, now: Date) => Promise<Audience>;
  schedule?: typeof scheduleJob;
  now?: () => Date;
  newBatchId?: () => string;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Los parámetros de URL de Contactos (`etiqueta=a&etiqueta=b&q=x`) como los entienden los filtros; solo claves conocidas. */
export function parseAudienceQuery(raw: unknown): SearchParams {
  if (typeof raw !== "string" || raw.length > 4000) return {};
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = all.length === 1 ? all[0] : all;
  }
  return sanitizeAudienceParams(out);
}

/** La audiencia real: los contactos de Contactos con esos filtros, como los ve la persona (hasta uno más que el tope). */
export async function resolveContactAudience(env: BulkEnv, params: SearchParams, now: Date): Promise<Audience> {
  const customFields = await loadCustomFieldRefs(env.user, env.workspaceId);
  const search = sanitizeSearch(firstParam(params.q));
  const { plan } = await prepareContactList(env.user, env.workspaceId, params, customFields, search, { now, timeZone: env.timeZone });
  const { data, count, error } = await contactListQuery(env.user, env.workspaceId, "id", plan)
    .order("id")
    .range(0, MAX_GENERATE_MANY);
  if (error) throw new Error(`No pude leer la audiencia: ${error.message}`);
  const ids = ((data ?? []) as unknown as { id: string }[]).map((r) => r.id);
  return { ids: ids.slice(0, MAX_GENERATE_MANY), total: Math.max(count ?? ids.length, ids.length) };
}

interface TemplateInfo {
  id: string;
  verify: boolean;
  /** Los datos propios que la plantilla usa y no tienen valor por defecto: ninguna persona de la tanda los tiene. */
  blockers: string[];
}

async function readTemplate(db: Db, workspaceId: string, templateId: string): Promise<TemplateInfo | { error: string }> {
  const { data, error } = await db.from("design_templates").select("id, verify, archived_at, doc, custom_vars").eq("id", templateId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    console.error("[designer] no pude leer la plantilla:", error.message);
    return { error: "No se pudo leer la plantilla." };
  }
  if (!data) return { error: "La plantilla ya no existe." };
  const row = data as unknown as { id: string; verify: boolean; archived_at: string | null; doc: unknown; custom_vars: unknown };
  if (row.archived_at) return { error: "La plantilla está archivada: restaurala para generar piezas." };
  const parsed = parseDesignDoc(row.doc);
  if (!parsed.ok) return { error: "El documento de la plantilla no es válido." };
  const blockers = requiredCustomVars(parseCustomVarsList(row.custom_vars), docVariables(parsed.doc)).map((v) => v.label);
  return { id: row.id, verify: row.verify, blockers };
}

export { blockersMessage };

export interface AudienceCount {
  total: number;
  existing: number;
  willGenerate: number;
  /** El máximo por tanda. */
  limit: number;
  /** Son más de los que entran en una tanda. */
  over: boolean;
  /** Los datos propios que faltan para generar «para varios» (vacío = se puede). */
  blockers: string[];
}

/** «N cumplen · M ya tienen uno válido (se saltean)»: lo que se ve en el modal antes de confirmar. */
export async function countGenerationAudienceCore(env: BulkEnv, input: { templateId: string; audienceParams: unknown; skipExisting: boolean }, depsIn: BulkDeps = {}): Promise<ActionResult<AudienceCount>> {
  try {
    const template = await readTemplate(env.service, env.workspaceId, input.templateId);
    if ("error" in template) return fail(template.error);
    const audience = await (depsIn.audience ?? resolveContactAudience)(env, parseAudienceQuery(input.audienceParams), (depsIn.now ?? (() => new Date()))());
    const existing = audience.ids.length > 0 ? (await findValidForContacts(env.service, env.workspaceId, input.templateId, audience.ids)).size : 0;
    return {
      ok: true,
      data: {
        total: audience.total,
        existing,
        willGenerate: audience.ids.length - (input.skipExisting ? existing : 0),
        limit: MAX_GENERATE_MANY,
        over: audience.total > MAX_GENERATE_MANY,
        blockers: template.blockers,
      },
    };
  } catch (error) {
    console.error("[designer] countGenerationAudience falló:", error instanceof Error ? error.message : "error");
    return fail("No pudimos contar a quiénes les toca. Probá de nuevo.");
  }
}

/**
 * Generar para varios: fija la audiencia y encola `design_generate_many`. Hasta 500 por tanda. Las piezas aparecen «En
 * proceso» en Generaciones a medida que el job las crea.
 */
export async function generateManyCore(
  env: BulkEnv,
  input: { templateId: string; audienceParams: unknown; skipExisting: boolean; publish: boolean; email?: { subject: string; body: string } | null },
  depsIn: BulkDeps = {},
): Promise<ActionResult<{ queued: number }>> {
  try {
    if (input.email) {
      const problem = emailProblems(input.email);
      if (problem) return fail(problem);
    }
    const template = await readTemplate(env.service, env.workspaceId, input.templateId);
    if ("error" in template) return fail(template.error);
    if (template.blockers.length > 0) return fail(blockersMessage(template.blockers));
    const now = (depsIn.now ?? (() => new Date()))();
    const audience = await (depsIn.audience ?? resolveContactAudience)(env, parseAudienceQuery(input.audienceParams), now);
    if (audience.total === 0 || audience.ids.length === 0) return fail("No hay contactos con esos filtros.");
    if (audience.total > MAX_GENERATE_MANY) return fail(`Son ${audience.total} contactos y el máximo es ${MAX_GENERATE_MANY} por vez. Sumá un filtro para generar de a tandas.`);

    const ids = [...new Set(audience.ids)];
    const existing = input.skipExisting ? (await findValidForContacts(env.service, env.workspaceId, input.templateId, ids)).size : 0;
    const queued = ids.length - existing;
    if (queued === 0) return fail("Todos ya tienen una pieza válida: no hay nada para generar.");

    const batchId = (depsIn.newBatchId ?? (() => crypto.randomUUID()))();
    const payload: GenerateManyPayload = {
      workspaceId: env.workspaceId,
      templateId: input.templateId,
      batchId,
      userId: env.userId,
      contactIds: ids,
      skipExisting: input.skipExisting,
      publish: input.publish,
      email: input.email ?? null,
      offset: 0,
      attempt: 0,
    };
    await (depsIn.schedule ?? scheduleJob)(env.service, DESIGN_GENERATE_MANY_JOB, { ...payload }, now, `design_generate_many:${batchId}:0`);
    return { ok: true, data: { queued } };
  } catch (error) {
    console.error("[designer] generateMany falló:", error instanceof Error ? error.message : "error");
    return fail("No se pudo preparar la tanda. Probá de nuevo.");
  }
}
