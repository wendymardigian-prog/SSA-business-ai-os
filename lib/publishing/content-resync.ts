/**
 * Reenviarle a Zernio lo que cambio de una pieza ya agendada alla (cambio
 * aprobado M10: una pieza programada se sigue editando).
 *
 * Zernio guarda su propia copia del texto y los archivos cuando se programa.
 * Si despues se edita la pieza y nadie le avisa, publica la version vieja
 * mientras la pantalla muestra la nueva. Esto lo usan los tres lugares que
 * cambian lo que se publica: guardar el editor, agregar un archivo y sacarlo.
 *
 * Dos pasos, porque el primero va ANTES de escribir la pieza:
 *  1. `planContentResync`: que redes agendadas cambian de contenido, y que la
 *     version nueva pase la misma validacion que al programar.
 *  2. `applyContentResync`: despues de guardar, reencolar cada una.
 *
 * Recibe el cliente de servicio: quien llama ya comprobo que la persona puede
 * escribir la pieza.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaEntry } from "@/lib/content/media";
import { networkContents, providerResyncTargets } from "@/lib/content/network-content";
import type { NetworkEntry } from "@/lib/content/redistribution";
import { validateNetwork } from "@/lib/content/validation";
import { platformLabel } from "@/lib/platforms";
import type { Database } from "@/lib/types/database";
import { schedulesOnProvider } from "./provider-scheduling";
import { resyncProviderPublication } from "./reschedule";

type Db = SupabaseClient<Database>;

/** Lo que define que se publica: el caption base, la biblioteca y las redes. */
export interface PieceContentState {
  caption: string | null;
  media: unknown;
  networks: unknown;
}

export interface ResyncTarget {
  id: string;
  platform: string;
}

const asNetworks = (value: unknown) => (Array.isArray(value) ? value : []) as unknown as NetworkEntry[];
const asMedia = (value: unknown) => (Array.isArray(value) ? value : []) as unknown as MediaEntry[];

export async function planContentResync(
  service: Db,
  params: { postId: string; before: PieceContentState; after: PieceContentState },
): Promise<{ ok: true; targets: ResyncTarget[] } | { ok: false; error: string }> {
  const { data: rows, error } = await service
    .from("social_posts")
    .select("id, platform, status, publisher, publisher_ref")
    .eq("content_post_id", params.postId)
    .is("deleted_at", null);

  if (error) {
    // No saber si hay algo agendado no puede frenar el guardado: se guarda y
    // se avisa en el log. Lo peor que pasa es lo que pasaba antes de M10.
    console.error("[publishing] no pude leer las publicaciones para reenviar:", error.message);
    return { ok: true, targets: [] };
  }

  const publications = (rows ?? []).map((r) => ({
    id: r.id,
    platform: r.platform,
    status: r.status,
    onProvider: schedulesOnProvider(r.publisher) && Boolean(r.publisher_ref),
  }));
  if (!publications.some((p) => p.onProvider && p.status === "scheduled")) return { ok: true, targets: [] };

  const contents = (state: PieceContentState) =>
    networkContents({ networks: asNetworks(state.networks), baseCaption: state.caption, baseMedia: asMedia(state.media) });

  const targets = providerResyncTargets({
    before: contents(params.before),
    after: contents(params.after),
    publications,
  });

  // La misma regla que al programar: si se guardara algo que la red rechaza,
  // Zernio fallaria a la hora de publicar, cuando ya nadie esta mirando.
  for (const target of targets) {
    const result = validateNetwork(target.content);
    if (!result.ok) {
      return {
        ok: false,
        error: `${platformLabel(target.platform)} está programada y así no se puede publicar: ${result.errors[0]} Corregilo o desprogramala.`,
      };
    }
  }
  return { ok: true, targets: targets.map(({ id, platform }) => ({ id, platform })) };
}

/** Devuelve los avisos de las que no se pudieron reenviar. Nunca lanza. */
export async function applyContentResync(
  service: Db,
  params: { workspaceId: string; targets: ResyncTarget[] },
): Promise<string[]> {
  const warnings: string[] = [];
  for (const target of params.targets) {
    try {
      const sent = await resyncProviderPublication(service, {
        socialPostId: target.id,
        workspaceId: params.workspaceId,
      });
      if (!sent) warnings.push(`${platformLabel(target.platform)}: no pude mandarle la versión nueva a Zernio.`);
    } catch (err) {
      console.error("[publishing] fallo el reenvio a Zernio:", err);
      warnings.push(`${platformLabel(target.platform)}: no pude mandarle la versión nueva a Zernio.`);
    }
  }
  return warnings;
}
