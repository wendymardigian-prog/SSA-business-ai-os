/**
 * La barra de uso de una card de integracion (F6).
 *
 * Varias integraciones tienen un tope de plan gratis que se toca sin darse
 * cuenta: Zernio permite 2 cuentas y la tercera cuesta USD 6 por mes, Postproxy
 * publica 10 veces por mes. Enterarse el dia que falla una publicacion es
 * tarde, asi que la card muestra cuanto se lleva usado y la pantalla marca
 * "Requiere atencion" al 90 % (F2).
 *
 * El calculo es puro: el numero usado lo trae quien llama. Contar viven en
 * `usage-counts.ts`, que si toca la base.
 */

import type { ProviderDefinition } from "./providers";

/** Desde donde se considera que una integracion "requiere atencion" por uso. */
export const USAGE_ATTENTION_RATIO = 0.9;

export interface UsageSnapshot {
  /** Que se cuenta: "cuentas conectadas", "publicaciones este mes". */
  label: string;
  used: number;
  /** Tope del plan. null = no hay tope conocido. */
  limit: number | null;
  /** 0 a 1. null cuando no hay tope (no se puede dibujar una barra). */
  ratio: number | null;
  /** Lo que se muestra debajo de la card. */
  text: string;
  /** Ya se llego al tope. */
  atLimit: boolean;
  /** Se paso del 90 %: la card pasa a "Requiere atencion". */
  needsAttention: boolean;
  /** Que pasa si se quiere una mas ("la siguiente cuesta USD 6 por mes"). */
  hint?: string;
}

/**
 * Arma la barra de uso de una integracion. Devuelve null si esa integracion no
 * cuenta nada (la mayoria).
 */
export function buildUsage(provider: ProviderDefinition, used: number): UsageSnapshot | null {
  const definition = provider.usage;
  if (!definition) return null;

  // Un numero negativo o roto es un error de quien cuenta, no algo que la
  // pantalla tenga que dibujar: se trata como cero.
  const safeUsed = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  const limit = definition.limit;

  if (limit === null || limit <= 0) {
    return {
      label: definition.label,
      used: safeUsed,
      limit: null,
      ratio: null,
      text: `${safeUsed} ${definition.label}`,
      atLimit: false,
      needsAttention: false,
      hint: definition.atLimitHint,
    };
  }

  const ratio = Math.min(safeUsed / limit, 1);
  const atLimit = safeUsed >= limit;

  return {
    label: definition.label,
    used: safeUsed,
    limit,
    ratio,
    text: `${safeUsed} de ${limit} ${definition.label}`,
    atLimit,
    needsAttention: ratio >= USAGE_ATTENTION_RATIO,
    // El aviso del tope solo tiene sentido cuando se llego: antes es ruido.
    hint: atLimit ? definition.atLimitHint : undefined,
  };
}
