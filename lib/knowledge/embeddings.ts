/**
 * De donde sale el embedding de la base de conocimiento (F16).
 *
 * Espeja a lib/ai/provider.ts: integration_configs dice si Voyage esta
 * conectado, la key vive encriptada en Vault, y la key nunca sale de aca. Lo
 * que se devuelve son los vectores, o un problema con un mensaje ya redactado
 * para mostrarle a un admin.
 *
 * Se lee con el service client porque read_secret solo lo aceptan Owner/Admin o
 * service_role, y el job de indexacion corre sin usuario.
 *
 * Voyage hace SOLO embeddings. El proveedor del nodo AI Response (texto) es
 * independiente: se puede usar Claude para conversar y Voyage para indexar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSecret, SECRET_NAMES, type SecretName } from "@/lib/vault";
import { getProvider } from "@/lib/integrations/providers";
import { createServiceClient } from "@/lib/supabase/server";
import {
  embedTexts,
  isRetryable,
  DEFAULT_EMBEDDING_MODEL,
  type VoyageProblem,
  type VoyageResult,
} from "./voyage";

/** El id de Voyage en el catalogo de integraciones y en integration_configs. */
export const VOYAGE_PROVIDER_ID = "voyage";

export type EmbeddingProblem = VoyageProblem | "not_connected" | "read_failed";

export interface EmbeddingFailure {
  ok: false;
  problem: EmbeddingProblem;
  /** Listo para mostrar. Nunca incluye la key ni el contenido del documento. */
  message: string;
  /** Si conviene reintentar mas tarde o esta perdido. */
  retryable: boolean;
}

export interface EmbeddingSuccess {
  ok: true;
  embeddings: number[][];
  model: string;
  totalTokens: number;
}

export type EmbeddingResult = EmbeddingSuccess | EmbeddingFailure;

interface VoyageConfigRow {
  vault_secret_name: string | null;
  config: Record<string, unknown> | null;
}

/**
 * Esta Voyage conectado en este workspace?
 *
 * Lo usa la pantalla de la KB para avisar que falta la key ANTES de que la
 * usuaria suba un documento y se lo encuentre en "error". No lee la key: solo
 * mira si la integracion esta activa.
 */
export async function isEmbeddingProviderConnected(
  workspaceId: string,
  supabase?: SupabaseClient,
): Promise<boolean> {
  const client = supabase ?? (await createServiceClient());

  const { data, error } = await client
    .from("integration_configs")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("type", "ai_provider")
    .eq("provider", VOYAGE_PROVIDER_ID)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("[kb] no pude ver si Voyage esta conectado:", error.message);
    return false;
  }

  return Boolean(data);
}

/** El modelo de embeddings configurado, o el default. */
export async function getEmbeddingModel(
  workspaceId: string,
  supabase?: SupabaseClient,
): Promise<string> {
  const client = supabase ?? (await createServiceClient());

  const { data } = await client
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", workspaceId)
    .eq("type", "ai_provider")
    .eq("provider", VOYAGE_PROVIDER_ID)
    .eq("is_active", true)
    .maybeSingle();

  const configured = (data?.config as Record<string, unknown> | null)?.embedding_model;
  return typeof configured === "string" && configured.trim()
    ? configured.trim()
    : DEFAULT_EMBEDDING_MODEL;
}

export interface GenerateEmbeddingsOptions {
  /** 'document' al indexar, 'query' al buscar. */
  inputType: "document" | "query";
  supabase?: SupabaseClient;
  /** Inyectable para los tests. */
  embedImpl?: typeof embedTexts;
}

/**
 * Genera los embeddings de una lista de textos con la key del workspace.
 *
 * Nunca lanza. Si Voyage no esta conectado o la key falla, vuelve un
 * EmbeddingFailure con el motivo: el resto del sistema tiene que seguir
 * funcionando aunque la KB no se pueda indexar.
 */
export async function generateEmbeddings(
  workspaceId: string,
  texts: string[],
  options: GenerateEmbeddingsOptions,
): Promise<EmbeddingResult> {
  const supabase = options.supabase ?? (await createServiceClient());
  const embed = options.embedImpl ?? embedTexts;

  const { data, error } = await supabase
    .from("integration_configs")
    .select("vault_secret_name, config")
    .eq("workspace_id", workspaceId)
    .eq("type", "ai_provider")
    .eq("provider", VOYAGE_PROVIDER_ID)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("[kb] no pude leer la configuracion de Voyage:", error.message);
    return {
      ok: false,
      problem: "read_failed",
      message: "No se pudo leer la configuracion de Voyage AI.",
      // Un fallo de lectura de la base suele ser un blip: vale reintentar.
      retryable: true,
    };
  }

  if (!data) {
    return {
      ok: false,
      problem: "not_connected",
      message:
        "Voyage AI no esta conectado. Se conecta en Ajustes > Integraciones y es lo que indexa la base de conocimiento.",
      retryable: false,
    };
  }

  const row = data as VoyageConfigRow;
  const definition = getProvider(VOYAGE_PROVIDER_ID);
  const secretName = (row.vault_secret_name ??
    definition?.secretName ??
    SECRET_NAMES.voyageApiKey) as SecretName;

  let apiKey: string | null = null;
  try {
    apiKey = await readSecret(supabase, workspaceId, secretName);
  } catch {
    // readSecret ya logueo el motivo, sin el valor.
    return {
      ok: false,
      problem: "read_failed",
      message: "No se pudo leer la API key de Voyage AI.",
      retryable: true,
    };
  }

  const model =
    typeof row.config?.embedding_model === "string" && row.config.embedding_model.trim()
      ? (row.config.embedding_model as string).trim()
      : DEFAULT_EMBEDDING_MODEL;

  const result: VoyageResult = await embed(apiKey, texts, {
    inputType: options.inputType,
    model,
  });

  if (result.ok) {
    return {
      ok: true,
      embeddings: result.embeddings,
      model: result.model,
      totalTokens: result.totalTokens,
    };
  }

  return {
    ok: false,
    problem: result.problem,
    message: result.message,
    retryable: isRetryable(result.problem),
  };
}

/** El embedding de una consulta, para la busqueda semantica. */
export async function embedQuery(
  workspaceId: string,
  query: string,
  options: Omit<GenerateEmbeddingsOptions, "inputType"> = {},
): Promise<{ ok: true; embedding: number[] } | EmbeddingFailure> {
  const result = await generateEmbeddings(workspaceId, [query], {
    ...options,
    inputType: "query",
  });

  if (!result.ok) return result;

  const embedding = result.embeddings[0];
  if (!embedding) {
    return {
      ok: false,
      problem: "transient",
      message: "Voyage AI no devolvio el embedding de la consulta.",
      retryable: true,
    };
  }

  return { ok: true, embedding };
}
