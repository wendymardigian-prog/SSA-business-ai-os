/**
 * De donde salen los datos de Evolution (WhatsApp) — F4.
 *
 * Hasta la etapa 2 vivian en variables de entorno de Railway: la direccion del
 * servidor, la clave y el token del webhook. Eso tiene dos problemas. Uno,
 * cambiar cualquiera de los tres exige un deploy. Dos, y peor, son de todo el
 * sistema y no de un workspace: el dia que haya dos negocios, los dos usan el
 * mismo WhatsApp.
 *
 * Ahora se leen por workspace: la direccion y el prefijo desde
 * `integration_configs`, la clave y el token desde Vault. **Las variables de
 * entorno siguen valiendo como respaldo**, y esa es la parte importante: hasta
 * que alguien cargue los datos en la pantalla, WhatsApp funciona exactamente
 * como hoy. Cuando no hay nada en ningun lado, el error es el mismo de antes
 * (null, y la pantalla dice "WhatsApp no esta configurado").
 *
 * La caracterizacion de ese comportamiento esta en
 * `app/api/webhooks/evolution/route.test.ts` y en `lib/evolution-config.test.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import type { EvolutionConfig } from "@/lib/evolution-client";

/** Lo que se guarda en `integration_configs.config` de Evolution. */
interface EvolutionStoredConfig {
  api_url?: string;
  instance_prefix?: string;
}

/** Los valores del entorno, que son el respaldo. */
export function evolutionEnvConfig(): Partial<EvolutionConfig> {
  return {
    baseUrl: process.env.EVOLUTION_API_URL?.trim().replace(/\/$/, "") || undefined,
    apiKey: process.env.EVOLUTION_API_KEY?.trim() || undefined,
    instancePrefix: process.env.EVOLUTION_INSTANCE_PREFIX?.trim() || undefined,
  };
}

/**
 * La configuracion de Evolution de un workspace.
 *
 * Orden: lo guardado en el workspace primero, las variables de entorno despues,
 * campo por campo. Asi se puede tener la direccion en la pantalla y la clave
 * todavia en el entorno, que es como va a quedar durante la migracion.
 *
 * Devuelve null si falta la direccion o la clave, igual que antes.
 */
export async function getEvolutionConfig(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<EvolutionConfig | null> {
  const env = evolutionEnvConfig();

  const { data: row } = await supabase
    .from("integration_configs")
    .select("config, is_active")
    .eq("workspace_id", workspaceId)
    .eq("type", "channel")
    .eq("provider", "evolution")
    .maybeSingle();

  const stored = (row?.is_active ? ((row.config ?? {}) as EvolutionStoredConfig) : {}) ?? {};

  const baseUrl = (stored.api_url?.trim().replace(/\/$/, "") || env.baseUrl) ?? null;
  // La clave solo se busca en Vault si la integracion esta activa: una lectura
  // por cada mensaje que sale no vale la pena cuando no hay nada guardado.
  const apiKey =
    (row?.is_active ? await readSecretSafe(supabase, workspaceId, SECRET_NAMES.evolutionApiKey) : null) ||
    env.apiKey ||
    null;

  if (!baseUrl || !apiKey) return null;

  return {
    baseUrl,
    apiKey,
    instancePrefix: stored.instance_prefix?.trim() || env.instancePrefix || "ssa",
  };
}

/**
 * El token con el que se valida el webhook de Evolution de un workspace.
 *
 * El receptor resuelve primero el canal por su instancia; de ahi sale el
 * workspace y de ahi el token. Si no hay canal conocido —el servidor puede
 * estar compartido con otro sistema— se valida contra el token del entorno,
 * que es lo que se hacia siempre.
 */
export async function getEvolutionWebhookToken(
  supabase: SupabaseClient<Database>,
  workspaceId: string | null,
): Promise<string | null> {
  if (workspaceId) {
    const fromVault = await readSecretSafe(
      supabase,
      workspaceId,
      SECRET_NAMES.evolutionWebhookToken,
    );
    if (fromVault) return fromVault;
  }
  return process.env.EVOLUTION_WEBHOOK_TOKEN?.trim() || null;
}

/**
 * Lee un secreto sin romper si no esta.
 *
 * `readSecret` lanza cuando la RPC falla, y aca "no hay nada guardado" no es un
 * error: es el caso normal mientras los datos sigan en el entorno.
 */
async function readSecretSafe(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  name: string,
): Promise<string | null> {
  try {
    return (await readSecret(supabase, workspaceId, name)) || null;
  } catch {
    return null;
  }
}
