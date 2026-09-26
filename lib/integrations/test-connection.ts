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

    default:
      // Las demas no tienen una prueba barata y sin efectos.
      return { ok: true };
  }
}
