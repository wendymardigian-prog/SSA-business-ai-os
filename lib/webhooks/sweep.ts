/**
 * La retencion de los envios (F7), una vez por dia: el payload se vacia a los 90 dias y la fila
 * se borra a los 12 meses. Con el cliente de servicio (las tablas no tienen policy de borrado).
 * Tambien se vacian las COPIAS del envio (Tiron 2, C4): `variables.webhook` de las sesiones terminadas y el
 * payload de los jobs `resume_flow` terminados, a los mismos 90 dias. Nunca lanza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { Json } from "@/lib/types/database";
import { FINISHED_JOB_STATUSES, FINISHED_SESSION_STATUSES, retentionCutoffs, stripJobPayloadCopies, stripWebhookCopies, type StripResult } from "./retention";

type Db = SupabaseClient<Database>;

export interface SweepResult {
  cleared: number;
  deleted: number;
  /** Sesiones de flujo terminadas a las que se les vacio la copia del envio. */
  sessionCopiesCleared: number;
  /** Jobs `resume_flow` terminados a los que se les vacio la copia del envio. */
  jobCopiesCleared: number;
}

/** De a cuanto se leen y cuantas tandas por corrida: lo que sobre sigue manana (lo ya vaciado no vuelve a salir). */
const COPY_BATCH = 200;
const COPY_MAX_BATCHES = 10;
const COPY_CONCURRENCY = 20;

/**
 * Vacia, de a tandas, la copia del envio de las filas que la tienen. `table` y `column` son del codigo (nunca del
 * pedido). El filtro `->> <> '{}'` deja afuera lo ya vaciado: sin eso, cada dia se releeria todo lo viejo.
 * Dos pasadas (la del `payload` y la de la `query`) porque un envio por GET solo tiene query.
 */
async function clearCopies(
  db: Db,
  args: {
    table: "flow_sessions" | "scheduled_jobs";
    column: "variables" | "payload";
    /** La ruta jsonb de la copia, hasta antes de `payload`/`query`. */
    path: string;
    filters: (q: any) => any;
    strip: (value: unknown) => StripResult;
  },
): Promise<number> {
  let total = 0;
  for (const key of ["payload", "query"] as const) {
    for (let batch = 0; batch < COPY_MAX_BATCHES; batch++) {
      const query = args.filters(db.from(args.table).select(`id, ${args.column}`)).neq(`${args.path}->>${key}`, "{}").limit(COPY_BATCH);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as ({ id: string } & Record<string, unknown>)[];
      if (rows.length === 0) break;

      let progressed = 0;
      for (let i = 0; i < rows.length; i += COPY_CONCURRENCY) {
        const results = await Promise.all(
          rows.slice(i, i + COPY_CONCURRENCY).map(async (row) => {
            const stripped = args.strip(row[args.column]);
            if (!stripped.changed) return false;
            const { error: updateError } = await db.from(args.table).update({ [args.column]: stripped.value as Json } as never).eq("id", row.id);
            return !updateError;
          }),
        );
        progressed += results.filter(Boolean).length;
      }
      total += progressed;
      // Si nada avanzo (una tanda de filas que no se pudieron escribir), no se insiste: lo reintenta la corrida de manana.
      if (progressed === 0 || rows.length < COPY_BATCH) break;
    }
  }
  return total;
}

export async function sweepInboundRetention(db: Db, now: Date = new Date()): Promise<SweepResult> {
  const { clearBefore, deleteBefore } = retentionCutoffs(now);
  let cleared = 0;
  let deleted = 0;
  let sessionCopiesCleared = 0;
  let jobCopiesCleared = 0;
  try {
    const { data: cleared_ } = await db
      .from("inbound_webhooks")
      .update({ payload: null, query: null } as never)
      .lte("received_at", clearBefore)
      .not("payload", "is", null)
      .select("id");
    cleared = (cleared_ ?? []).length;

    // Los envios de mas de 12 meses, de a 500. Una sesion de flujo que quedo SIN contacto (arranco por
    // este envio y nunca consiguio uno) no tiene nada que conservar: sin el envio es una fila huerfana. (Hasta la
    // 00218 ademas era obligatorio: su FK es SET NULL y el CHECK de la 00187 la rechazaba; ahora la sostiene su
    // origen, pero sigue siendo basura.) Se borra antes; las que tienen contacto se conservan (pierden solo el vinculo).
    const { data: old } = await db.from("inbound_webhooks").select("id").lte("received_at", deleteBefore).limit(500);
    const ids = ((old ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length > 0) {
      await db.from("flow_sessions").delete().in("inbound_webhook_id" as never, ids).is("contact_id", null).is("member_user_id", null);
      const { data: deleted_ } = await db.from("inbound_webhooks").delete().in("id", ids).select("id");
      deleted = (deleted_ ?? []).length;
    }
  } catch (err) {
    console.error("[hooks] fallo la retencion de webhooks:", err instanceof Error ? err.message : String(err));
  }

  // Las copias del envio, cada una por su lado: que una falle no frena a la otra.
  try {
    sessionCopiesCleared = await clearCopies(db, {
      table: "flow_sessions",
      column: "variables",
      path: "variables->webhook",
      filters: (q) => q.in("status", [...FINISHED_SESSION_STATUSES]).lte("updated_at", clearBefore),
      strip: stripWebhookCopies,
    });
  } catch (err) {
    console.error("[hooks] no pude vaciar la copia del envio en las sesiones:", err instanceof Error ? err.message : String(err));
  }
  try {
    jobCopiesCleared = await clearCopies(db, {
      table: "scheduled_jobs",
      column: "payload",
      path: "payload->variables->webhook",
      filters: (q) => q.eq("type", "resume_flow").in("status", [...FINISHED_JOB_STATUSES]).lte("run_at", clearBefore),
      strip: stripJobPayloadCopies,
    });
  } catch (err) {
    console.error("[hooks] no pude vaciar la copia del envio en los jobs:", err instanceof Error ? err.message : String(err));
  }
  return { cleared, deleted, sessionCopiesCleared, jobCopiesCleared };
}
