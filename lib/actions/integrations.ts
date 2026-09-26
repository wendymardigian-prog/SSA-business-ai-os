"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { storeSecret, deleteSecret, listSecretNames } from "@/lib/vault";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { validateSecretValue } from "@/lib/integrations/secret-validation";
import {
  configProviderOf,
  getVisibleProvider,
  secretFieldsOf,
  validateConfig,
  type ProviderDefinition,
  type SecretField,
} from "@/lib/integrations/providers";

/**
 * Server Actions de la pantalla de integraciones.
 *
 * Tres reglas que valen para las tres funciones:
 *
 * 1. El rol se revalida ACA, en el servidor. El guard de la pagina y el menu
 *    son comodidad; la barrera real es esta comprobacion mas la RLS de
 *    integration_configs (migracion 00020).
 * 2. El formato de la key se revalida ACA aunque el cliente ya lo haya hecho.
 * 3. La key va a Vault primero. Recien si eso sale bien se marca la
 *    integracion como conectada: asi nunca queda una card en verde sin key
 *    guardada detras.
 *
 * Ninguna de estas funciones devuelve el valor de una key. Al cliente solo le
 * llega si hay una guardada o no.
 */

const INTEGRATIONS_PATH = "/dashboard/settings/integrations";

export type IntegrationActionResult = { ok: true } | { ok: false; error: string };


/** Solo los campos que declara el proveedor: nada de guardar lo que mande el cliente. */
function cleanConfigOf(
  provider: ProviderDefinition,
  config: Record<string, string>,
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const field of provider.configFields) {
    const value = (config[field.key] ?? "").trim();
    if (value) clean[field.key] = value;
  }
  return clean;
}

export interface SaveIntegrationInput {
  providerId: string;
  /** Los secretos nuevos, por la clave del campo. Lo que no venga, no se toca. */
  secrets?: Record<string, string>;
  config?: Record<string, string>;
}

/**
 * Guarda (o rota) los secretos de una integracion y la deja conectada.
 *
 * Una integracion puede tener varios secretos (Evolution: la API key del
 * servidor y el token del webhook; una app de OAuth: Client ID y Secret), asi
 * que se recibe un mapa y no un string suelto. Lo que no viene en el mapa se
 * deja como estaba: el modal muestra "Guardado ✓ · Reemplazar" y solo manda lo
 * que la persona volvio a escribir.
 *
 * Nunca devuelve el valor de un secreto.
 */
export async function saveIntegration(
  input: SaveIntegrationInput,
): Promise<IntegrationActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden configurar integraciones" };

  // getVisibleProvider y no getProvider: una integracion que todavia no se
  // muestra tampoco se puede guardar, aunque alguien arme el pedido a mano.
  const provider = getVisibleProvider(input.providerId);
  if (!provider) return { ok: false, error: "Integracion desconocida" };

  const { workspace, supabase } = ctx;
  const secrets = input.secrets ?? {};
  const config = input.config ?? {};
  const fields = secretFieldsOf(provider);

  const [{ data: existing }, storedNames] = await Promise.all([
    supabase
      .from("integration_configs")
      .select("id, is_active")
      .eq("workspace_id", workspace.id)
      .eq("type", provider.type)
      .eq("provider", configProviderOf(provider))
      .maybeSingle(),
    fields.length > 0 ? listSecretNames(supabase, workspace.id) : Promise.resolve([] as string[]),
  ]);

  const alreadyStored = new Set(storedNames);

  // Se valida TODO antes de escribir nada: si el segundo secreto esta mal, no
  // puede quedar el primero guardado y la integracion a medio conectar.
  const toStore: Array<{ field: SecretField; value: string }> = [];
  for (const field of fields) {
    const value = (secrets[field.key] ?? "").trim();
    if (!value) {
      if (field.required && !alreadyStored.has(field.secretName)) {
        return { ok: false, error: `Falta ${field.label.toLowerCase()}` };
      }
      continue;
    }
    const check = validateSecretValue(field, value);
    if (!check.ok) return check;
    toStore.push({ field, value });
  }

  const configCheck = validateConfig(provider.id, config);
  if (!configCheck.ok) return configCheck;

  for (const { field, value } of toStore) {
    const stored = await storeSecret(supabase, workspace.id, field.secretName, value);
    if (!stored.ok) {
      return { ok: false, error: `No se pudo guardar ${field.label.toLowerCase()} de forma segura: ${stored.error}` };
    }
  }

  const row = {
    workspace_id: workspace.id,
    type: provider.type,
    provider: configProviderOf(provider),
    display_name: provider.label,
    vault_secret_name: provider.secretName,
    config: cleanConfigOf(provider, config),
    is_active: true,
    connected_at: existing?.is_active ? undefined : new Date().toISOString(),
    last_error: null,
  };

  const { error } = await supabase
    .from("integration_configs")
    .upsert(row, { onConflict: "workspace_id,type,provider" });

  if (error) {
    console.error(`[integrations] upsert "${provider.id}" fallido:`, error.message);
    return {
      ok: false,
      error: `Los datos se guardaron pero no pude activar la integracion: ${error.message}`,
    };
  }

  // Conectar una integracion es de las cosas que despues nadie se acuerda quien
  // hizo. La entidad es el workspace porque integration_configs se hace upsert
  // y no tiene una fila estable a la que apuntar. Nunca un valor de secreto:
  // solo QUE campos se rotaron.
  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: existing?.is_active ? "update" : "create",
    metadata: {
      provider: provider.id,
      type: provider.type,
      secrets_rotated: toStore.map((s) => s.field.key),
    },
    performedBy: ctx.user.id,
  });

  revalidatePath(INTEGRATIONS_PATH);
  return { ok: true };
}

/** Cambia la config (remitente, modelo) sin tocar ningun secreto. */
export async function updateIntegrationConfig(
  providerId: string,
  config: Record<string, string>,
): Promise<IntegrationActionResult> {
  return saveIntegration({ providerId, config });
}

/**
 * Cuantas publicaciones programadas dependen de esta integracion.
 *
 * Se muestra ANTES de desconectar: desconectar LinkedIn con tres posts
 * programados para el jueves los deja fallando el jueves, y enterarse ese dia
 * es tarde.
 *
 * Hoy devuelve 0 siempre: la tabla `social_posts` la crea el bloque 3. La
 * funcion existe desde ahora para que el modal tenga donde preguntar y el
 * bloque 3 solo tenga que cambiar el cuerpo, no la pantalla.
 */
export async function countScheduledUses(providerId: string): Promise<number> {
  const ctx = await getAdminContext();
  if (!ctx) return 0;
  if (!getVisibleProvider(providerId)) return 0;

  // TODO(bloque 3): contar social_posts con status 'scheduled' cuyo publicador
  // sea de esta integracion.
  return 0;
}

/** Borra los secretos de Vault y deja la integracion desconectada. */
export async function disconnectIntegration(
  providerId: string,
): Promise<IntegrationActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden configurar integraciones" };

  const provider = getVisibleProvider(providerId);
  if (!provider) return { ok: false, error: "Integracion desconocida" };

  const { workspace, supabase } = ctx;

  for (const field of secretFieldsOf(provider)) {
    const removed = await deleteSecret(supabase, workspace.id, field.secretName);
    if (!removed.ok) {
      return { ok: false, error: `No se pudo borrar ${field.label.toLowerCase()}: ${removed.error}` };
    }
  }

  // La fila se conserva desactivada: guarda el historial de cuando estuvo
  // conectada y la config (remitente, modelo) para no retipearla al reconectar.
  const { error } = await supabase
    .from("integration_configs")
    .update({ is_active: false, vault_secret_name: null, connected_at: null, last_error: null })
    .eq("workspace_id", workspace.id)
    .eq("type", provider.type)
    .eq("provider", configProviderOf(provider));

  if (error) {
    console.error(`[integrations] desconectar "${provider.id}" fallido:`, error.message);
    return { ok: false, error: error.message };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "delete", metadata: { provider: provider.id, type: provider.type },
    performedBy: ctx.user.id,
  });

  revalidatePath(INTEGRATIONS_PATH);
  return { ok: true };
}

/**
 * Los proveedores de IA conectados, para el selector del nodo AI Response.
 *
 * Solo lectura y sin nada sensible: id, etiqueta y modelos disponibles. La key
 * no sale de Vault ni aparece por ningun lado.
 *
 * Es Owner/Admin porque configurar el nodo de IA tambien lo es. Un Member que
 * mira un flow ve el nodo, no el selector.
 */
export async function listAiProviders(): Promise<
  Array<{ provider: string; label: string; defaultModel: string; models: string[] }>
> {
  const ctx = await getAdminContext();
  if (!ctx) return [];
  return listConnectedAiProviders(ctx.workspace.id);
}
