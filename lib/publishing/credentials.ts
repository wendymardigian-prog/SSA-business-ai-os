/**
 * De donde saca cada publicador su secreto (F35).
 *
 * Dos familias distintas:
 * - **Servicios con clave fija** (Zernio, Postproxy): una API key en Vault,
 *   del workspace.
 * - **Cuentas conectadas por OAuth** (YouTube, LinkedIn, Threads): un access
 *   token por conexion, guardado con el prefijo de `oauth_connections`.
 *
 * Que el token este vencido NO se arregla aca: si vencio, publicar falla con
 * un error permanente y la pantalla de integraciones lo muestra. Refrescarlo
 * en medio de una publicacion escondería una conexión rota hasta que el
 * refresh también falle, que es peor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OAuthProvider } from "@/lib/types/database";
import { readSecret, SECRET_NAMES, oauthSecretName } from "@/lib/vault";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { PublishError } from "@/lib/jobs/errors";
import type { PublishCredentials } from "./types";

type Db = SupabaseClient<Database>;

/** Que conexion OAuth usa cada publicador. */
const OAUTH_PROVIDER: Record<string, OAuthProvider> = {
  youtube_api: "google",
  linkedin_api: "linkedin",
  threads_api: "threads",
};

export async function credentialsForPublisher(
  supabase: Db,
  params: { publisherId: string; workspaceId: string },
): Promise<PublishCredentials> {
  const { publisherId, workspaceId } = params;

  if (publisherId === "zernio") {
    const key = await getZernioApiKey(workspaceId, { supabase: supabase as never });
    if (!key) {
      throw new PublishError(
        "Falta la clave de Zernio. Cargala en Ajustes → Integraciones.",
        "permanent",
      );
    }
    return { token: key };
  }

  if (publisherId === "postproxy") {
    const key = await readSecret(supabase, workspaceId, SECRET_NAMES.postproxyApiKey);
    if (!key) {
      throw new PublishError(
        "Falta la clave de Postproxy. Cargala en Ajustes → Integraciones.",
        "permanent",
      );
    }
    return { token: key };
  }

  const provider = OAUTH_PROVIDER[publisherId];
  if (!provider) {
    throw new PublishError(`No se de donde sacar la clave de "${publisherId}"`, "permanent");
  }

  const { data: connection } = await supabase
    .from("oauth_connections")
    .select("vault_secret_prefix, status, token_expires_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .is("user_id", null)
    .maybeSingle();

  if (!connection) {
    throw new PublishError(
      `La cuenta de ${provider} no esta conectada. Conectala en Ajustes → Integraciones.`,
      "permanent",
    );
  }
  if (connection.status === "revoked") {
    throw new PublishError(
      `La conexion con ${provider} se revoco. Volve a conectarla.`,
      "permanent",
    );
  }

  const token = await readSecret(
    supabase,
    workspaceId,
    oauthSecretName(connection.vault_secret_prefix, "access_token"),
  );
  if (!token) {
    throw new PublishError(
      `No encontre el token de ${provider}. Volve a conectar la cuenta.`,
      "permanent",
    );
  }

  return { token };
}
