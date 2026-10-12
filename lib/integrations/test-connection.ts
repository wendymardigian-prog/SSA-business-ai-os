/**
 * "Probar y guardar" (F3): que la clave sirva ANTES de darla por buena.
 *
 * Validar el formato atrapa el copiado a medias, pero no una clave revocada o
 * de otra cuenta. Eso solo lo sabe el proveedor. Guardar una clave que no
 * funciona deja la card en verde y la falla aparece recien el dia que hay que
 * publicar.
 *
 * No todas las integraciones se pueden probar asi: las de OAuth se prueban
 * conectando (ahi esta la prueba de verdad). Las de IA SI se prueban: listar
 * los modelos no cobra tokens y devuelve 401 con una key mala (ver
 * ai-key-check.ts). La que queda sin prueba es Voyage, que no publica un
 * endpoint gratis; para esa, la validacion de formato es lo que hay.
 *
 * Solo servidor: usa las claves.
 */

import type { FetchLike } from "@/lib/oauth/types";
import { testApiKey as testPostproxyKey } from "@/lib/social/postproxy";
import { validateMetaToken } from "@/lib/meta/token";
import { fetchAdAccounts } from "@/lib/meta/accounts";
import { checkAiProviderKey } from "./ai-key-check";

export type ConnectionTest =
  | {
      ok: true;
      detail?: string;
      /**
       * Lo que la prueba descubrio y conviene guardar (A11).
       *
       * Postproxy es el caso: el perfil de YouTube solo se sabe preguntandole
       * a su API, y despues hace falta en cada publicacion. Pedirlo de nuevo
       * cada vez seria una llamada de mas; guardarlo al probar la clave es el
       * unico momento en que ya se tiene.
       */
      config?: Record<string, string | string[]>;
    }
  | { ok: false; error: string };

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
        ...(youtube[0]?.id ? { config: { youtube_profile_id: youtube[0].id } } : {}),
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

    case "openai":
    case "anthropic":
    case "google_ai": {
      const apiKey = (input.secrets.api_key ?? "").trim();
      // Sin clave nueva no hay nada que probar: se esta editando el modelo por
      // defecto y la key que ya estaba guardada sigue siendo la buena.
      if (!apiKey) return { ok: true };

      const result = await checkAiProviderKey({
        providerId: input.providerId,
        apiKey,
        fetchImpl: input.fetchImpl,
      });
      if (!result.ok) return result;

      return {
        ok: true,
        detail: result.detail,
        // La lista viva de modelos viaja con la config: es lo que hace que el
        // selector del agente no dependa de una lista escrita a mano.
        ...(result.models.length > 0
          ? { config: { models: result.models, models_checked_at: new Date().toISOString() } }
          : {}),
      };
    }

    default:
      // Voyage y las de OAuth: no tienen una prueba barata y sin efectos.
      return { ok: true };
  }
}
