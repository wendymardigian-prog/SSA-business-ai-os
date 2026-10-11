/**
 * La memoria del contacto (F30): `contacts.ai_conversation_summary`, el resumen
 * integrado que el agente lee en la proxima conversacion.
 *
 * Dos procesos la escriben: el cierre de una conversacion (`lib/agent/summary.ts`)
 * y el resumen de una llamada (este). Entre que uno la lee, le pide al modelo
 * que la integre y la escribe pasan segundos: si el otro escribio en el medio,
 * pisarla perderia lo suyo. Por eso la escritura es CONDICIONAL: solo escribe
 * si `ai_summary_updated_at` sigue siendo el que se leyo. Si choca, se relee y
 * se vuelve a integrar UNA vez (partiendo de lo nuevo); si vuelve a chocar, se
 * deja `memory_status = 'conflict'` y una persona la reintenta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export interface MemoryState {
  memory: string | null;
  /** `ai_summary_updated_at` tal como lo devolvio la base (null = nunca se escribio). */
  updatedAt: string | null;
}

export async function readContactMemory(db: Db, contactId: string): Promise<MemoryState | null> {
  const { data } = await db.from("contacts").select("ai_conversation_summary, ai_summary_updated_at").eq("id", contactId).is("deleted_at", null).maybeSingle();
  if (!data) return null;
  return { memory: data.ai_conversation_summary ?? null, updatedAt: data.ai_summary_updated_at ?? null };
}

/** Escribe solo si nadie escribio desde `expectedUpdatedAt`. Devuelve false si choco. */
export async function writeContactMemory(db: Db, args: { contactId: string; memory: string; expectedUpdatedAt: string | null; now: Date }): Promise<boolean> {
  const base = db.from("contacts").update({ ai_conversation_summary: args.memory, ai_summary_updated_at: args.now.toISOString() }).eq("id", args.contactId);
  // `IS NOT DISTINCT FROM`: un null compara con null.
  const guarded = args.expectedUpdatedAt === null ? base.is("ai_summary_updated_at", null) : base.eq("ai_summary_updated_at", args.expectedUpdatedAt);
  const { data, error } = await guarded.select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export type MemoryOutcome =
  | { status: "applied"; previous: string | null; memory: string }
  | { status: "conflict" }
  | { status: "skipped" };

/**
 * Integra la memoria con control de concurrencia.
 *
 * `first` es lo que ya se produjo con la lectura inicial. `produce` vuelve a
 * pedirle al modelo la memoria partiendo de OTRO valor previo (el segundo
 * intento). Devuelve que paso y, si se aplico, el valor anterior (para la
 * auditoria).
 */
export async function applyMemory(
  db: Db,
  args: {
    contactId: string;
    read: MemoryState;
    first: string | null;
    produce: (previous: string | null) => Promise<string | null>;
    now: Date;
  },
): Promise<MemoryOutcome> {
  if (!args.first?.trim()) return { status: "skipped" };

  if (await writeContactMemory(db, { contactId: args.contactId, memory: args.first, expectedUpdatedAt: args.read.updatedAt, now: args.now })) {
    return { status: "applied", previous: args.read.memory, memory: args.first };
  }

  // Alguien escribio en el medio: se relee y se integra otra vez, partiendo de lo nuevo.
  const fresh = await readContactMemory(db, args.contactId);
  if (!fresh) return { status: "skipped" };
  const second = await args.produce(fresh.memory);
  if (!second?.trim()) return { status: "skipped" };
  if (await writeContactMemory(db, { contactId: args.contactId, memory: second, expectedUpdatedAt: fresh.updatedAt, now: args.now })) {
    return { status: "applied", previous: fresh.memory, memory: second };
  }
  return { status: "conflict" };
}
