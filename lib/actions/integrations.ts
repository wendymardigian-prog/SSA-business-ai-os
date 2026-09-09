"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { storeSecret, deleteSecret } from "@/lib/vault";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import {
  getProvider,
  validateApiKey,
  validateConfig,
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

/** Guarda (o rota) la API key de una integracion y la deja conectada. */
export async function saveIntegration(
  providerId: string,
  apiKey: string,
  config: Record<string, string>,
): Promise<IntegrationActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden configurar integraciones" };

  const provider = getProvider(providerId);
  if (!provider || !provider.secretName) {
    return { ok: false, error: "Integracion desconocida" };
  }

  const { workspace, supabase } = ctx;

  // Si ya hay una key guardada, se puede editar solo la config sin volver a
  // pegarla. Si no hay ninguna, la key es obligatoria.
  const { data: existing } = await supabase
    .from("integration_configs")
    .select("id, vault_secret_name, is_active")
    .eq("workspace_id", workspace.id)
    .eq("type", provider.type)
    .eq("provider", provider.id)
    .maybeSingle();

  const newKey = apiKey.trim();
  const hadKey = Boolean(existing?.vault_secret_name);

  if (!newKey && !hadKey) {
    return { ok: false, error: `Pega la API key de ${provider.label}` };
  }

  if (newKey) {
    const keyCheck = validateApiKey(provider.id, newKey);
    if (!keyCheck.ok) return keyCheck;
  }

  const configCheck = validateConfig(provider.id, config);
  if (!configCheck.ok) return configCheck;

  // Solo los campos que declara el proveedor: nada de guardar lo que mande el
  // cliente por su cuenta.
  const cleanConfig: Record<string, string> = {};
  for (const field of provider.configFields) {
    const value = (config[field.key] ?? "").trim();
    if (value) cleanConfig[field.key] = value;
  }

  if (newKey) {
    const stored = await storeSecret(supabase, workspace.id, provider.secretName, newKey);
    if (!stored.ok) {
      return { ok: false, error: `No se pudo guardar la key de forma segura: ${stored.error}` };
    }
  }

  const row = {
    workspace_id: workspace.id,
    type: provider.type,
    provider: provider.id,
    display_name: provider.label,
    vault_secret_name: provider.secretName,
    config: cleanConfig,
    is_active: true,
    connected_at: existing?.is_active ? undefined : new Date().toISOString(),
    last_error: null,
  };

  const { error } = await supabase
    .from("integration_configs")
    .upsert(row, { onConflict: "workspace_id,type,provider" });

  if (error) {
    console.error(`[integrations] upsert "${provider.id}" fallido:`, error.message);
    return { ok: false, error: `La key se guardo pero no pude activar la integracion: ${error.message}` };
  }

  // F20: conectar un canal es de las cosas que despues nadie se acuerda quien
  // hizo. La entidad es el workspace porque integration_configs no tiene una
  // fila estable a la que apuntar (se hace upsert), y el proveedor va en el
  // metadata. Nunca la key, obvio.
  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: existing?.is_active ? "update" : "create",
    metadata: {
      provider: provider.id,
      type: provider.type,
      key_rotated: Boolean(newKey) && hadKey,
    },
    performedBy: ctx.user.id,
  });

  revalidatePath(INTEGRATIONS_PATH);
  return { ok: true };
}

/** Cambia la config (remitente, modelo) sin tocar la key. */
export async function updateIntegrationConfig(
  providerId: string,
  config: Record<string, string>,
): Promise<IntegrationActionResult> {
  return saveIntegration(providerId, "", config);
}

/** Borra la key de Vault y deja la integracion desconectada. */
export async function disconnectIntegration(
  providerId: string,
): Promise<IntegrationActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden configurar integraciones" };

  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: "Integracion desconocida" };

  const { workspace, supabase } = ctx;

  if (provider.secretName) {
    const removed = await deleteSecret(supabase, workspace.id, provider.secretName);
    if (!removed.ok) {
      return { ok: false, error: `No se pudo borrar la key: ${removed.error}` };
    }
  }

  // La fila se conserva desactivada: guarda el historial de cuando estuvo
  // conectada y la config (remitente, modelo) para no retipearla al reconectar.
  const { error } = await supabase
    .from("integration_configs")
    .update({ is_active: false, vault_secret_name: null, connected_at: null, last_error: null })
    .eq("workspace_id", workspace.id)
    .eq("type", provider.type)
    .eq("provider", provider.id);

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
