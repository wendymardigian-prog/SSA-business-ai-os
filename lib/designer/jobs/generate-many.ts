/**
 * El job `design_generate_many`: Generar para varios (F51). Lo construye DS6.
 *
 * Recibe la audiencia YA fijada (la lista de contactos que la acción leyó con la sesión de la persona, así la RLS decidió
 * a quiénes ve) y crea una generación por contacto con `createGeneration`, en tandas de 10: cada pieza aparece «En proceso»
 * en Generaciones apenas se crea y su render va a la cola.
 *
 * - **Una tanda por vuelta, con tiempo límite**: si quedan contactos, el job se reagenda con el siguiente `offset` (una
 *   audiencia de 500 no se hace en una sola corrida larga).
 * - **Reanudable sin duplicar**: antes de crear mira qué contactos ya tienen una pieza de ESTE lote (`source_ref.batch_id`);
 *   un job que la cola corre dos veces no genera dos certificados.
 * - **«Saltear a quienes ya tienen uno válido»**: se mira al generar (no al contar), con la base de ese momento.
 * - **Nunca lanza por un proveedor**: un error pasajero (la base, la cola) deja a ese contacto para después, a 1, 5 y 15
 *   minutos, con un tope de tres pasadas; el resto sigue. Lo que falta de datos queda como pieza fallida con su motivo y
 *   avisa en la campana (una sola vez por plantilla cada 30 minutos).
 * - El email de «Mandar por email» sale cuando cada pieza queda lista (`registerGenerationEmail`), no acá.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { scheduleJob } from "@/lib/scheduler";
import { createGeneration, findValidForContacts, type CreateGenerationInput, type GenerationDeps } from "../generate-core";
import { registerGenerationEmail } from "../generation-email";

// El proceso que corre los jobs del Diseñador IA importa este archivo: acá se suscribe al aviso de «pieza lista» para mandar
// el email que se pidió al emitir.
registerGenerationEmail();

export const DESIGN_GENERATE_MANY_JOB = "design_generate_many";

/** Cuántas piezas se crean a la vez. */
export const GENERATE_MANY_BATCH = 10;
/** Cuánto puede tardar una vuelta antes de dejar el resto para la siguiente. */
export const GENERATE_MANY_BUDGET_MS = 40_000;
/** Esperas entre pasadas cuando algo falla de forma pasajera: 1, 5 y 15 minutos. */
export const GENERATE_MANY_RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

type Db = SupabaseClient<Database>;

export interface GenerateManyPayload {
  workspaceId: string;
  templateId: string;
  batchId: string;
  /** Quien lo pidió (va al historial y a «A mano · Para varios · <persona>»). */
  userId: string | null;
  contactIds: string[];
  skipExisting: boolean;
  publish: boolean;
  email: { subject: string; body: string } | null;
  /** Por dónde sigue (0 = desde el principio). */
  offset: number;
  /** Cuántas pasadas de reintento van (0 = la primera). */
  attempt: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_GENERATE_MANY = 500;

/** Revisa lo que trae el job. Algo que no tiene la forma esperada es `null` (se anota y se descarta, sin lanzar). */
export function parseGenerateManyPayload(raw: Record<string, unknown>): GenerateManyPayload | null {
  const text = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
  const workspaceId = text(raw.workspaceId);
  const templateId = text(raw.templateId);
  const batchId = text(raw.batchId);
  if (!workspaceId || !templateId || !batchId) return null;
  if (!Array.isArray(raw.contactIds) || raw.contactIds.length > MAX_GENERATE_MANY) return null;
  const contactIds = [...new Set(raw.contactIds.filter((id): id is string => typeof id === "string" && UUID.test(id)))];
  const email = raw.email && typeof raw.email === "object" ? (raw.email as { subject?: unknown; body?: unknown }) : null;
  const offset = typeof raw.offset === "number" && Number.isInteger(raw.offset) && raw.offset >= 0 ? raw.offset : 0;
  const attempt = typeof raw.attempt === "number" && Number.isInteger(raw.attempt) && raw.attempt >= 0 ? raw.attempt : 0;
  return {
    workspaceId,
    templateId,
    batchId,
    userId: text(raw.userId),
    contactIds,
    skipExisting: raw.skipExisting === true,
    publish: raw.publish === true,
    email: email && typeof email.subject === "string" && typeof email.body === "string" ? { subject: email.subject, body: email.body } : null,
    offset,
    attempt,
  };
}

export interface GenerateManyDeps extends GenerationDeps {
  create?: typeof createGeneration;
  schedule?: typeof scheduleJob;
  batchSize?: number;
  budgetMs?: number;
}

export type GenerateManyOutcome =
  | { status: "invalid" }
  | {
      status: "done" | "continued";
      created: number;
      failed: number;
      skipped: number;
      /** Errores que no se arreglan reintentando. */
      errors: number;
      /** Cuántos contactos quedaron para una pasada de reintento. */
      retrying: number;
    };

/** Agenda una vuelta más; una clave repetida (23505: ya hay una igual pendiente) alcanza. */
async function scheduleAgain(db: Db, schedule: typeof scheduleJob, payload: GenerateManyPayload, at: Date, key: string): Promise<boolean> {
  try {
    await schedule(db, DESIGN_GENERATE_MANY_JOB, { ...payload }, at, key);
    return true;
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") return true;
    console.error("[design_generate_many] no pude reagendar:", error instanceof Error ? error.message : "error");
    return false;
  }
}

export async function runGenerateMany(db: Db, raw: Record<string, unknown>, depsIn: GenerateManyDeps = {}): Promise<GenerateManyOutcome> {
  const payload = parseGenerateManyPayload(raw);
  if (!payload) {
    console.error("[design_generate_many] el job no trae lo necesario");
    return { status: "invalid" };
  }
  const now = depsIn.now ?? (() => new Date());
  const create = depsIn.create ?? createGeneration;
  const schedule = depsIn.schedule ?? scheduleJob;
  const batchSize = depsIn.batchSize ?? GENERATE_MANY_BATCH;
  const budgetMs = depsIn.budgetMs ?? GENERATE_MANY_BUDGET_MS;
  const started = now().getTime();
  const out = { created: 0, failed: 0, skipped: 0, errors: 0, retrying: 0 };
  const retry: string[] = [];
  const { workspaceId, templateId, batchId } = payload;

  // Lo que ya se hizo en este lote (un job que la cola corre dos veces no duplica) y, si se pidió, quién ya tiene una válida.
  let done = new Set<string>();
  let existing = new Map<string, { designId: string; code: string }>();
  try {
    const { data, error } = await db
      .from("designs")
      .select("subject_contact_id")
      .eq("workspace_id", workspaceId)
      .eq("template_id", templateId)
      .eq("source_ref->>batch_id", batchId);
    if (error) throw new Error(error.message);
    done = new Set((data ?? []).map((r) => (r as { subject_contact_id: string | null }).subject_contact_id).filter((id): id is string => !!id));
    const pending = payload.contactIds.slice(payload.offset).filter((id) => !done.has(id));
    if (payload.skipExisting && pending.length > 0) existing = await findValidForContacts(db, workspaceId, templateId, pending);
  } catch (error) {
    // Sin poder mirar qué se hizo no se genera nada (se duplicaría): esta vuelta se repite más tarde.
    console.error("[design_generate_many] no pude revisar el lote:", error instanceof Error ? error.message : "error");
    const wait = GENERATE_MANY_RETRY_MS[Math.min(payload.attempt, GENERATE_MANY_RETRY_MS.length - 1)];
    if (payload.attempt < GENERATE_MANY_RETRY_MS.length) await scheduleAgain(db, schedule, { ...payload, attempt: payload.attempt + 1 }, new Date(now().getTime() + wait), `design_generate_many:${batchId}:r${payload.attempt + 1}:${payload.offset}`);
    return { status: "continued", ...out, retrying: payload.contactIds.length - payload.offset };
  }

  let index = payload.offset;
  while (index < payload.contactIds.length) {
    if (index > payload.offset && now().getTime() - started > budgetMs) break;
    const slice = payload.contactIds.slice(index, index + batchSize);
    index += slice.length;
    await Promise.all(
      slice.map(async (contactId) => {
        if (done.has(contactId) || (payload.skipExisting && existing.has(contactId))) {
          out.skipped += 1;
          return;
        }
        const input: CreateGenerationInput = {
          workspaceId,
          templateId,
          contactId,
          overrides: {},
          // Sin dato que completar a mano: lo que falte queda como pieza fallida con su motivo (y avisa).
          policy: "fail",
          publish: payload.publish,
          source: "bulk",
          sourceRef: { kind: "bulk", batch_id: batchId, user_id: payload.userId },
          // Si no se pidió saltear, una plantilla con verificación reemplaza la anterior (una sola válida por persona).
          replaceExisting: !payload.skipExisting,
          actorUserId: payload.userId,
          email: payload.email,
        };
        const result = await create(db, input, depsIn);
        if (result.ok) {
          if (result.status === "failed") out.failed += 1;
          else out.created += 1;
        } else if (result.reason === "existing") out.skipped += 1;
        else if (result.retryable) retry.push(contactId);
        else out.errors += 1;
      }),
    );
  }

  let status: "done" | "continued" = "done";
  if (index < payload.contactIds.length) {
    status = "continued";
    await scheduleAgain(db, schedule, { ...payload, offset: index }, now(), `design_generate_many:${batchId}:${index}`);
  }
  if (retry.length > 0 && payload.attempt < GENERATE_MANY_RETRY_MS.length) {
    const wait = GENERATE_MANY_RETRY_MS[payload.attempt];
    if (await scheduleAgain(db, schedule, { ...payload, contactIds: retry, offset: 0, attempt: payload.attempt + 1 }, new Date(now().getTime() + wait), `design_generate_many:${batchId}:r${payload.attempt + 1}`)) out.retrying = retry.length;
    else out.errors += retry.length;
  } else out.errors += retry.length;
  return { status, ...out };
}
