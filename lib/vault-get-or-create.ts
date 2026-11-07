/**
 * Una clave propia del sistema que se genera la primera vez que hace falta y
 * queda en Vault (la firma de los links de formularios, de los links medidos y
 * del `state` del OAuth). SOLO servidor, siempre con el cliente de servicio.
 *
 * Vive aparte de `lib/vault.ts` para que los tests que simulan `readSecret` y
 * `storeSecret` (con `vi.mock("@/lib/vault")`) tambien la alcancen.
 *
 * La regla: crear SOLO si la lectura dio null. `readSecret` devuelve null si la
 * clave no esta y LANZA ante un error real (Vault caido, sin permiso). Antes un
 * `catch {}` tragaba ese error y se generaba una clave nueva que PISABA la
 * guardada (`store_secret` sobrescribe): todos los links firmados hasta ese
 * momento dejaban de valer. Ahora el error sube y quien llama decide.
 *
 * Despues de guardar se vuelve a leer y se usa LO GUARDADO: si dos primeros
 * usos crean a la vez, los dos terminan firmando con la misma (achica la
 * carrera; no la elimina del todo).
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SecretName } from "@/lib/secret-names";
import { readSecret, storeSecret } from "@/lib/vault";

export async function getOrCreateSecret(
  service: SupabaseClient,
  workspaceId: string,
  name: SecretName,
  /** Para el mensaje de error: que clave es ("de los links", "del OAuth"). */
  label: string,
): Promise<string> {
  const existing = await readSecret(service, workspaceId, name);
  if (existing) return existing;

  const secret = randomBytes(32).toString("base64url");
  const stored = await storeSecret(service, workspaceId, name, secret);
  if (!stored.ok) throw new Error(`No pude guardar la clave de firma ${label}: ${stored.error}`);

  const saved = await readSecret(service, workspaceId, name);
  if (!saved) throw new Error(`Guarde la clave de firma ${label} pero no la pude volver a leer`);
  return saved;
}
