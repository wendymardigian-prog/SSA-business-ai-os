/**
 * La red de seguridad de la programacion en Zernio (D6).
 *
 * El camino normal es el webhook: Zernio publica y avisa. Pero un webhook
 * puede no llegar —se cayo la app, se deshabilito la suscripcion, se perdio
 * el evento— y entonces la fila se queda diciendo "programado" para siempre
 * aunque el post ya este publicado en Instagram.
 *
 * Esto pregunta por las que deberian haber salido hace rato y no contestaron.
 * No publica ni cancela nada: solo pone al dia lo que ya paso del otro lado.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getPublisher } from "./registry";
import { rowFromResult } from "./dispatcher";
import { onPublicationSettled } from "./settled";
import { schedulesOnProvider } from "./provider-scheduling";
import type { PublishCredentials } from "./types";

type Db = SupabaseClient<Database>;

/**
 * Cuanto se espera despues de la hora antes de preguntar.
 *
 * Zernio publica cerca de la hora pedida, no exactamente: unos minutos de
 * diferencia son normales. Quince cubren eso y el viaje del webhook.
 */
export const RECONCILE_AFTER_MINUTES = 15;

export interface ReconcileDeps {
  credentialsFor(params: {
    publisherId: string;
    workspaceId: string;
    platform: string;
  }): Promise<PublishCredentials>;
}

export interface ReconcileResult {
  checked: number;
  updated: number;
}

/**
 * Pone al dia las publicaciones agendadas en el proveedor cuya hora ya paso.
 *
 * Nunca lanza: corre en el cron de jobs y que falle no puede frenar la cola.
 */
export async function reconcileProviderSchedules(
  supabase: Db,
  deps: ReconcileDeps,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const cutoff = new Date(now.getTime() - RECONCILE_AFTER_MINUTES * 60_000).toISOString();

  const { data: rows, error } = await supabase
    .from("social_posts")
    .select("id, workspace_id, platform, publisher, publisher_ref, scheduled_at")
    .eq("status", "scheduled")
    .not("publisher_ref", "is", null)
    .lt("scheduled_at", cutoff)
    .is("deleted_at", null)
    .limit(25);

  if (error) {
    console.error("[publishing] no pude buscar publicaciones por conciliar:", error.message);
    return { checked: 0, updated: 0 };
  }

  let checked = 0;
  let updated = 0;

  for (const row of rows ?? []) {
    if (!schedulesOnProvider(row.publisher) || !row.publisher_ref) continue;
    checked++;

    try {
      const publisher = getPublisher(row.publisher ?? "");
      if (!publisher.getStatus) continue;

      const credentials = await deps.credentialsFor({
        publisherId: row.publisher ?? "",
        workspaceId: row.workspace_id,
        platform: row.platform,
      });

      const result = await publisher.getStatus({
        ref: row.publisher_ref,
        platform: row.platform,
        credentials,
      });

      // Sigue en curso: no hay nada que corregir, y marcarla fallida por
      // impaciencia seria empujar a alguien a publicarla dos veces.
      if (result.status === "processing") continue;

      await supabase
        .from("social_posts")
        .update(rowFromResult(result, now))
        .eq("id", row.id)
        // Si el webhook llego entre la lectura y ahora, este update no pisa.
        .eq("status", "scheduled");

      await onPublicationSettled(supabase, row.id);
      updated++;
    } catch (err) {
      console.error(
        `[publishing] no pude conciliar ${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { checked, updated };
}
