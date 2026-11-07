/**
 * Las direcciones de una integracion a las que llama el servidor (`publicUrl`, como la de Evolution) no pueden
 * apuntar a la red interna: localhost, la red privada, `*.railway.internal` o la metadata de la nube. Si no,
 * quien edita la integracion haria que el servidor le pegue a algo que no se ve desde afuera.
 *
 * Solo se mira lo que CAMBIA: una direccion ya guardada no se vuelve a resolver en cada guardado (una falla
 * pasajera de DNS no tiene por que frenar cambiar el prefijo). El dominio publico de Railway
 * (`*.up.railway.app`) resuelve a IPs publicas y pasa.
 *
 * Solo servidor: resuelve nombres (`node:dns`).
 */
import { BlockedUrlError, assertPublicUrl } from "@/lib/net/safe-fetch";
import { changedConfigFields, type ProviderDefinition } from "@/lib/integrations/providers";

export async function publicUrlProblem(
  provider: ProviderDefinition,
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, string>,
): Promise<string | null> {
  for (const field of changedConfigFields(provider, previous, next)) {
    const value = (next[field.key] ?? "").trim();
    if (!field.publicUrl || !value) continue;
    try {
      await assertPublicUrl(value);
    } catch (err) {
      if (err instanceof BlockedUrlError) return `"${field.label}": ${err.message} Usá el dominio público del servidor.`;
      // El nombre no resolvio: con esa direccion tampoco se iba a poder mandar nada.
      return `"${field.label}": no encontré ese servidor. Revisá que la dirección esté bien escrita.`;
    }
  }
  return null;
}
