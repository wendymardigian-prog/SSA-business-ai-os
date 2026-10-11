/**
 * El bucket privado de contratos (firmas dibujadas y PDF). SOLO servidor.
 *
 * Es un puerto chico para que los jobs se prueben sin Storage: en producción lo arma
 * `contractStorage(service)`; los tests pasan uno propio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export const CONTRACTS_BUCKET = "contracts";

export interface ContractStorage {
  /** Los bytes del archivo, o `null` si no existe o no se pudo leer. */
  download(path: string): Promise<Uint8Array | null>;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<boolean>;
}

export function contractStorage(service: SupabaseClient<Database>): ContractStorage {
  return {
    async download(path) {
      const { data, error } = await service.storage.from(CONTRACTS_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async upload(path, bytes, mime) {
      const { error } = await service.storage.from(CONTRACTS_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
      if (error) console.error("[contratos] no pude subir un archivo:", error.message);
      return !error;
    },
  };
}
