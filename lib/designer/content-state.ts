/**
 * El estado de cada red de una pieza, leído de la cola de publicación (DS8).
 *
 * Es el mismo cálculo del drawer y del tablero (`networkStateOf`): una red está «Programada» solo si hay una fila viva
 * en `social_posts` Y la red tiene una cuenta conectada con publicador; una fila cancelada no cuenta. Lo usan el job
 * que sincroniza los archivos y la acción que describe el vínculo, para decidir con la misma verdad que ve la persona.
 *
 * Solo servidor (recibe el cliente de servicio).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { connectedPlatforms } from "@/lib/content/connection";
import { networkStateOf, type NetworkPublication, type NetworkStateView } from "@/lib/content/network-state";
import type { NetworkEntry } from "@/lib/content/redistribution";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/** Falla con un mensaje claro si la base no contesta: decidir con un estado a ciegas es peor que reintentar. */
export class StateReadError extends Error {}

export async function loadNetworkStates(db: Db, params: { postId: string; workspaceId: string; networks: NetworkEntry[] }): Promise<Map<string, NetworkStateView>> {
  const [pubs, accounts] = await Promise.all([
    db.from("social_posts").select("platform, status, scheduled_at, published_at, origin").eq("content_post_id", params.postId).is("deleted_at", null),
    db.from("social_accounts").select("platform, default_publisher").eq("workspace_id", params.workspaceId).eq("is_active", true),
  ]);
  if (pubs.error) throw new StateReadError(`No se pudieron leer las publicaciones (${pubs.error.message}).`);
  if (accounts.error) throw new StateReadError(`No se pudieron leer las cuentas (${accounts.error.message}).`);

  const connected = connectedPlatforms(
    ((accounts.data ?? []) as Array<{ platform: string; default_publisher: string | null }>).map((a) => ({ platform: a.platform, is_active: true, default_publisher: a.default_publisher })),
  );
  const publications = new Map<string, NetworkPublication>();
  for (const row of (pubs.data ?? []) as Array<{ platform: string; status: NetworkPublication["status"]; scheduled_at: string | null; published_at: string | null; origin: string | null }>) {
    // Una fila cancelada no es la publicación de verdad (igual que en el tablero).
    if (row.status === "cancelled") continue;
    publications.set(row.platform, { platform: row.platform, status: row.status, scheduledAt: row.scheduled_at, publishedAt: row.published_at, origin: row.origin });
  }

  const out = new Map<string, NetworkStateView>();
  for (const network of params.networks) {
    out.set(network.platform, networkStateOf({ plannedAt: network.planned_at ?? null, publication: publications.get(network.platform), connected: connected.includes(network.platform) }));
  }
  return out;
}
