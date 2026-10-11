/**
 * Los jobs de una llamada (clasificar, analizar, resumir, mandar a
 * Conocimiento). Un job por llamada y por tipo: su clave de dedupe es
 * `<tipo>:<callId>`, asi que encolar dos veces la misma llamada deja UN job
 * pendiente (el segundo choca con el unico y no es un error).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { scheduleJob } from "@/lib/scheduler";

type Db = SupabaseClient<Database>;

export const CALL_JOB_TYPES = ["call_classify", "call_analyze", "call_summary", "call_index_knowledge"] as const;
export type CallJobType = (typeof CALL_JOB_TYPES)[number];

export function callJobKey(type: CallJobType, callId: string): string {
  return `${type}:${callId}`;
}

/** Encola el job de una llamada. Un duplicado pendiente no es un error. */
export async function enqueueCallJob(
  db: Db,
  type: CallJobType,
  callId: string,
  now: Date = new Date(),
  extra: Record<string, unknown> = {},
  runAt: Date = now,
): Promise<{ queued: boolean }> {
  try {
    await scheduleJob(db, type, { callId, ...extra }, runAt, callJobKey(type, callId));
    return { queued: true };
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return { queued: false };
    throw err;
  }
}

export const enqueueClassify = (db: Db, callId: string, now: Date = new Date()) => enqueueCallJob(db, "call_classify", callId, now).then(() => undefined);
