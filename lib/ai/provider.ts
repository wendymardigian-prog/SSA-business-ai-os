import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { readSecret, type SecretName } from "@/lib/vault";
import { getProvider } from "@/lib/integrations/providers";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * De donde saca el modelo de IA el nodo AI Response (F2).
 *
 * Hasta ahora la key salia de la columna workspaces.ai_api_key —en claro, sin
 * proveedor, y en la practica vacia— y todo pasaba por el AI Gateway de Vercel.
 * El propio codigo del nodo lo marcaba como deuda a saldar en esta fase.
 *
 * Ahora sale del BYOK que ya existia desde la Fase 1: integration_configs dice
 * que proveedor esta conectado, y la key vive encriptada en Supabase Vault. La
 * key nunca sale de esta funcion: no se devuelve, no se loguea, no se manda al
 * cliente. Lo que se devuelve es un modelo ya listo para usar.
 *
 * Se lee con el service client porque read_secret solo lo aceptan Owner/Admin
 * o service_role, y el motor corre sin usuario.
 */

/** Por que no se pudo armar el modelo. Sirve para dar un aviso util. */
export type AiProviderProblem =
  | "no_provider"
  | "no_key"
  | "unsupported_provider"
  | "read_failed";

export interface AiModelResult {
  ok: boolean;
  model?: LanguageModel;
  /** Proveedor efectivamente usado. */
  provider?: string;
  /** Modelo efectivamente usado. */
  modelId?: string;
  problem?: AiProviderProblem;
  /** Aviso listo para mostrarle a un admin. Nunca incluye la key. */
  message?: string;
}

interface AiIntegrationRow {
  provider: string;
  vault_secret_name: string | null;
  config: Record<string, unknown> | null;
}

/**
 * Devuelve el modelo del proveedor conectado en el workspace.
 *
 * `preferred` permite que un nodo pida un proveedor puntual; si ese no esta
 * conectado, se usa el que si lo este en vez de fallar, porque es mejor
 * contestar con otro modelo que no contestar.
 */
export async function getWorkspaceModel(
  workspaceId: string,
  options: {
    preferredProvider?: string;
    modelId?: string;
    supabase?: SupabaseClient;
  } = {}
): Promise<AiModelResult> {
  const supabase = options.supabase ?? (await createServiceClient());

  const { data, error } = await supabase
    .from("integration_configs")
    .select("provider, vault_secret_name, config")
    .eq("workspace_id", workspaceId)
    .eq("type", "ai_provider")
    .eq("is_active", true);

  if (error) {
    console.error("[ai] no pude leer los proveedores conectados:", error.message);
    return {
      ok: false,
      problem: "read_failed",
      message: "No se pudo leer la configuracion de IA del workspace.",
    };
  }

  const rows = (data ?? []) as AiIntegrationRow[];
  if (rows.length === 0) {
    return {
      ok: false,
      problem: "no_provider",
      message:
        "No hay ningun proveedor de IA conectado. Se configura en Ajustes > Integraciones.",
    };
  }

  const chosen =
    rows.find((r) => r.provider === options.preferredProvider) ?? rows[0];

  const definition = getProvider(chosen.provider);
  if (!definition) {
    return {
      ok: false,
      problem: "unsupported_provider",
      message: `El proveedor "${chosen.provider}" no esta soportado.`,
    };
  }

  let apiKey: string | null = null;
  try {
    apiKey = await readSecret(
      supabase,
      workspaceId,
      (chosen.vault_secret_name ?? definition.secretName) as SecretName
    );
  } catch {
    // readSecret ya loguea el motivo, sin el valor.
    return {
      ok: false,
      problem: "read_failed",
      message: `No se pudo leer la API key de ${definition.label}.`,
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      problem: "no_key",
      message: `Falta la API key de ${definition.label}. Se carga en Ajustes > Integraciones.`,
    };
  }

  const modelId =
    options.modelId ||
    (chosen.config?.default_model as string | undefined) ||
    defaultModelFor(chosen.provider);

  const model = buildModel(chosen.provider, apiKey, modelId);
  if (!model) {
    return {
      ok: false,
      problem: "unsupported_provider",
      message: `El proveedor "${chosen.provider}" no se puede usar para generar texto.`,
    };
  }

  return { ok: true, model, provider: chosen.provider, modelId };
}

/**
 * Arma el modelo del SDK.
 *
 * Cada proveedor se instancia con SU key, no con una global: es lo que hace que
 * esto sea BYOK de verdad y que el consumo se facture a la cuenta del negocio.
 */
function buildModel(
  provider: string,
  apiKey: string,
  modelId: string
): LanguageModel | null {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    case "google_ai":
      return createGoogleGenerativeAI({ apiKey })(modelId);
    default:
      return null;
  }
}

/** El modelo por defecto que declara el catalogo de proveedores. */
function defaultModelFor(provider: string): string {
  const definition = getProvider(provider);
  const field = definition?.configFields?.find((f) => f.key === "default_model");
  return (field?.defaultValue as string | undefined) ?? "";
}

/**
 * Los proveedores conectados, para que la UI pueda ofrecerlos.
 *
 * Devuelve solo id y modelo por defecto: ni la key ni nada que se le parezca.
 */
export async function listConnectedAiProviders(
  workspaceId: string,
  supabase?: SupabaseClient
): Promise<Array<{ provider: string; label: string; defaultModel: string; models: string[] }>> {
  const client = supabase ?? (await createServiceClient());

  const { data } = await client
    .from("integration_configs")
    .select("provider, config")
    .eq("workspace_id", workspaceId)
    .eq("type", "ai_provider")
    .eq("is_active", true);

  return ((data ?? []) as AiIntegrationRow[]).flatMap((row) => {
    const definition = getProvider(row.provider);
    if (!definition) return [];
    const field = definition.configFields?.find((f) => f.key === "default_model");
    return [
      {
        provider: row.provider,
        label: definition.label,
        defaultModel:
          (row.config?.default_model as string | undefined) ??
          (field?.defaultValue as string | undefined) ??
          "",
        models: (field?.options as string[] | undefined) ?? [],
      },
    ];
  });
}
