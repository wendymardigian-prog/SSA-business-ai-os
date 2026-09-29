import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Precio de un modelo y cuanto costo un uso, en USD.
 *
 * Los precios viven en `model_pricing` (migracion 00059, sembrada con
 * supabase/seeds/00_model_pricing.sql) y no en el codigo: cambian seguido y el
 * numero no deberia depender de un deploy. No hay lista cerrada de modelos: si
 * uno no tiene fila, el costo es null y el run lo avisa, pero no se pierde.
 *
 * El costo se calcula una sola vez, al cerrar el run, y se congela. Por eso la
 * busqueda del precio recibe el instante: se aplica el vigente en ese momento.
 */

type Db = SupabaseClient<Database>;

export interface ModelPrice {
  id: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cached_input_per_mtok: number;
  /**
   * USD por HORA de audio (00103). Solo lo tienen los modelos de
   * transcripcion, que se cobran por duracion y no por tokens. Null en los de
   * chat y de embeddings.
   */
  audio_per_hour: number | null;
}

/** Tokens de una llamada al modelo de chat. */
export interface ChatTokens {
  /** Entrada TOTAL, incluidos los cacheados (asi la reporta el AI SDK). */
  input: number;
  /** De esa entrada, cuantos se leyeron de cache. */
  cachedRead: number;
  output: number;
}

/**
 * El precio vigente de un modelo en un instante: la fila mas reciente con
 * valid_from <= at. Devuelve null si no hay, o si la lectura fallo (el run se
 * guarda igual, con el costo en null).
 */
export async function resolvePricing(
  supabase: Db,
  args: { workspaceId: string; provider: string; model: string; at: Date },
): Promise<ModelPrice | null> {
  let data: {
    id: string;
    input_per_mtok: number;
    output_per_mtok: number;
    cached_input_per_mtok: number;
    audio_per_hour: number | null;
  } | null = null;
  let error: { message: string } | null = null;
  try {
    const result = await supabase
      .from("model_pricing")
      .select("id, input_per_mtok, output_per_mtok, cached_input_per_mtok, audio_per_hour")
      .eq("workspace_id", args.workspaceId)
      .eq("provider", args.provider)
      .eq("model", args.model)
      .lte("valid_from", args.at.toISOString())
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    data = result.data;
    error = result.error;
  } catch (err) {
    error = { message: err instanceof Error ? err.message : "error desconocido" };
  }

  if (error) {
    console.error("[ai-cost] no pude leer el precio:", error.message);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    // numeric llega como string desde PostgREST.
    input_per_mtok: Number(data.input_per_mtok),
    output_per_mtok: Number(data.output_per_mtok),
    cached_input_per_mtok: Number(data.cached_input_per_mtok),
    // `== null` a proposito: cubre null y undefined. Si la columna no volvio
    // (una base sin la 00103 aplicada), Number(undefined) seria NaN y el costo
    // terminaria en NaN en vez de quedar desconocido.
    audio_per_hour: data.audio_per_hour == null ? null : Number(data.audio_per_hour),
  };
}

const PER_MILLION = 1_000_000;

/** Seis decimales, igual que la columna numeric(12,6). */
function roundUsd(value: number): number {
  return Math.round(value * PER_MILLION) / PER_MILLION;
}

/** Un conteo que puede venir undefined, negativo o NaN de un proveedor. */
export function safeTokens(value: number | undefined | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Costo de chat. Los cacheados se cobran UNA vez, a su precio: se restan de la
 * entrada total antes de aplicarle el precio normal. Contarlos en los dos
 * lados es el error facil de este calculo.
 *
 * Las escrituras de cache (Anthropic las cobra a 1,25x) quedan dentro de la
 * entrada normal: el agente no marca breakpoints de cache y no aparecen.
 */
export function computeChatCostUsd(price: ModelPrice, tokens: ChatTokens): number {
  const input = safeTokens(tokens.input);
  const cached = Math.min(safeTokens(tokens.cachedRead), input);
  const output = safeTokens(tokens.output);
  const nonCached = input - cached;

  return roundUsd(
    (nonCached * price.input_per_mtok +
      cached * price.cached_input_per_mtok +
      output * price.output_per_mtok) /
      PER_MILLION,
  );
}

/** Costo de embeddings: solo entrada. */
export function computeEmbeddingCostUsd(price: ModelPrice, tokens: number): number {
  return roundUsd((safeTokens(tokens) * price.input_per_mtok) / PER_MILLION);
}

const SECONDS_PER_HOUR = 3_600;

/**
 * Costo de una transcripcion: segundos de audio por el precio de la hora.
 *
 * Devuelve null si el modelo no tiene precio de audio cargado, que es distinto
 * de cero: cero diria "salio gratis" y el informe mostraria un total falso.
 */
export function computeAudioCostUsd(price: ModelPrice, seconds: number): number | null {
  if (price.audio_per_hour === null) return null;
  const safe = typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return roundUsd((safe / SECONDS_PER_HOUR) * price.audio_per_hour);
}
