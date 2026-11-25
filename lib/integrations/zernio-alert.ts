/**
 * Fallos del sistema (25/11/2026, traído de RER): Zernio rechaza la clave del negocio (401). Mientras tanto Instagram
 * no sincroniza cuentas ni manda mensajes por la API. Avisa a Owner y Admin; un aviso que no se repite en 7 días.
 * Nunca lanza.
 */
import { notifySystemFailure } from "@/lib/notifications/system-alerts";
import { zernioStatus } from "@/lib/publishing/zernio-errors";

/** Si un error del SDK de Zernio es la clave rechazada (no un fallo de red ni de una red social). */
export function isZernioKeyRejected(err: unknown): boolean {
  return zernioStatus(err) === 401;
}

export async function alertZernioKeyRejected(supabase: unknown, workspaceId: string, err: unknown): Promise<boolean> {
  if (!isZernioKeyRejected(err)) return false;
  return notifySystemFailure({
    supabase,
    workspaceId,
    type: "zernio_key_error",
    key: "zernio",
    title: "Zernio rechaza la clave",
    body: "Zernio respondió 401. Instagram no sincroniza cuentas ni manda mensajes por la API hasta que vuelvas a pegar la clave en Integraciones › Zernio.",
    area: "integrations",
    metadata: { status: 401 },
  });
}
