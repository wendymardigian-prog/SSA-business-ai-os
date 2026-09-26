/**
 * "Probar y guardar" (F3): que la clave sirva ANTES de darla por buena.
 *
 * Validar el formato atrapa el copiado a medias, pero no una clave revocada o
 * de otra cuenta. Eso solo lo sabe el proveedor. Guardar una clave que no
 * funciona deja la card en verde y la falla aparece recien el dia que hay que
 * publicar.
 *
 * No todas las integraciones se pueden probar asi: las de OAuth se prueban
 * conectando (ahi esta la prueba de verdad), y las de IA no tienen una llamada
 * gratis y sin efectos. Para esas, esto no hace nada y la validacion de
 * formato es lo que hay.
 *
 * Solo servidor: usa las claves.
 */

import type { FetchLike } from "@/lib/oauth/types";
import { testApiKey as testPostproxyKey } from "@/lib/social/postproxy";
import { validateMetaToken } from "@/lib/meta/token";
import { fetchAdAccounts } from "@/lib/meta/accounts";

export type ConnectionTest = { ok: true; detail?: string } | { ok: false; error: string };

export interface TestInput {
  providerId: string;
  /** Los secretos que se estan por guardar, por clave del campo. */
  secrets: Record<string, string>;
  config: Record<string, string>;
  fetchImpl?: FetchLike;
}

export async function testConnection(input: TestInput): Promise<ConnectionTest> {
  switch (input.providerId) {
    case "postproxy": {
      const apiKey = (input.secrets.api_key ?? "").trim();
      // Sin clave nueva no hay nada que probar: se esta editando otra cosa.
      if (!apiKey) return { ok: true };

      const result = await testPostproxyKey(apiKey, input.fetchImpl);
      if (!result.ok) return result;

      const youtube = result.profiles.filter((p) => p.platform === "youtube");
      return {
        ok: true,
        detail:
          youtube.length > 0
            ? `Conectado. Hay ${youtube.length} cuenta(s) de YouTube en Postproxy.`
            : "Conectado, pero todavia no hay ninguna cuenta de YouTube en Postproxy.",
      };
    }

    case "meta": {
      const token = (input.secrets.system_user_token ?? "").trim();
      if (!token) return { ok: true };

      // Dos pasos, y los dos importan: `/me` dice si el token sirve, y
      // `/me/adaccounts` dice si tiene el permiso `ads_read`. Un token
      // valido sin ese permiso pasaria el primero y no traeria nada.
      const identity = await validateMetaToken(token, input.fetchImpl as typeof fetch);
      if (!identity.ok) return identity;

      const accounts = await fetchAdAccounts(token, input.fetchImpl as typeof fetch);
      if (!accounts.ok) return { ok: false, error: accounts.error };

      return {
        ok: true,
        detail:
          accounts.accounts.length > 0
            ? `Conectado. El token alcanza ${accounts.accounts.length} cuenta(s) publicitaria(s): elegí cuáles sincronizar.`
            : "Conectado, pero el token no alcanza ninguna cuenta publicitaria. Revisá los permisos en el Business Manager.",
      };
    }

    default:
      // Las demas no tienen una prueba barata y sin efectos.
      return { ok: true };
  }
}
