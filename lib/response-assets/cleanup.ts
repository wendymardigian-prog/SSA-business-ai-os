/**
 * Red de seguridad: borra el archivo de un recurso de audio dado de baja
 * hace mas de 28 dias, por si el borrado inmediato fallo.
 *
 * `deleteAsset` y el reemplazo de `updateAsset`
 * (lib/actions/response-assets.ts) ya borran el archivo del bucket EN EL
 * MOMENTO: nadie mas lo referencia (una conversacion que lo mando se quedo
 * con su propia copia, lib/response-assets/send-copy.ts). Esto es el
 * cinturon ademas de los tirantes, para cuando ese borrado inmediato no se
 * pudo hacer (el service role no respondio, un corte de red).
 *
 * 28 dias y no 30: deja un margen antes de que `purge_soft_deleted` (00106)
 * se lleve la fila entera. No se escribe nada en la base: `storage_path`
 * sigue NOT NULL para un audio (CHECK `response_assets_audio_shape`, que no
 * exime a una fila borrada), asi que la unica forma idempotente de barrer es
 * reintentar el borrado del archivo sin tocar la fila -- borrar un objeto
 * que ya no esta no da error, asi que reintentar los dos dias que faltan
 * hasta la purga no tiene costo.
 *
 * Se cuelga del mismo cron diario que ya limpia la media del chat, las
 * piezas publicadas y las fotos de perfil (content-media-cleanup): mismo
 * criterio, sin sumar una ruta de cron nueva.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media/bucket";

type Db = SupabaseClient<Database>;

export const ASSET_ORPHAN_RETENTION_DAYS = 28;

const BATCH = 200;

export interface AssetToCleanStorage {
  id: string;
  storage_path: string | null;
}

export interface AssetCleanupPlan {
  assetId: string;
  path: string;
}

/** Que archivos reintentar: los de un recurso de audio con storage_path todavia escrito. */
export function planAssetStorageCleanup(args: { assets: AssetToCleanStorage[] }): AssetCleanupPlan[] {
  const plans: AssetCleanupPlan[] = [];
  for (const asset of args.assets) {
    if (!asset.storage_path) continue;
    plans.push({ assetId: asset.id, path: asset.storage_path });
  }
  return plans;
}

export async function cleanupOrphanedAssetFiles(
  supabase: Db,
  now: Date = new Date(),
): Promise<{ attempted: number; failed: number }> {
  const cutoff = new Date(now.getTime() - ASSET_ORPHAN_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: assets, error } = await supabase
    .from("response_assets")
    .select("id, storage_path")
    .eq("kind", "audio")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .not("storage_path", "is", null)
    .limit(BATCH);

  if (error) {
    console.error("[response-assets-cleanup] no pude leer los recursos dados de baja:", error.message);
    return { attempted: 0, failed: 0 };
  }

  const plans = planAssetStorageCleanup({ assets: assets ?? [] });
  let failed = 0;

  for (const plan of plans) {
    const { error: storageError } = await supabase.storage.from(CHAT_MEDIA_BUCKET).remove([plan.path]);
    if (storageError) {
      // No se reintenta aca mismo: mañana vuelve a entrar en el barrido.
      console.error(`[response-assets-cleanup] ${plan.assetId}:`, storageError.message);
      failed++;
    }
  }

  return { attempted: plans.length, failed };
}
