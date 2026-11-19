/**
 * Lo que el dashboard de Meta Ads y la pantalla Anuncios piden en vivo, como promesas que la pagina no espera.
 *
 * La pagina arma la cabecera con lo que ya tiene (cuentas, periodo, filas guardadas) y manda estas promesas al navegador;
 * cada tarjeta las lee con `use()` adentro de su `Suspense`. Por eso **ninguna puede rechazar**: un rechazo tiraria la
 * pantalla abajo. Lo que falla es «Meta no lo dio» (null, un guion), nunca un cero.
 *
 * Modulo puro: no sabe de Supabase ni de Meta.
 */

import type { LiveResult, UniqueReach } from "@/lib/meta/live";
import type { LiveReach } from "./ads";

/** El alcance unico del periodo y lo que hay que avisar si Meta no lo dio. */
export interface AccountReach {
  /** El alcance unico del periodo, de la consulta en vivo. Null si no se pudo leer. */
  uniqueReach: number | null;
  /** La frecuencia de la misma respuesta de Meta que `uniqueReach`. */
  uniqueFrequency: number | null;
  /** El motivo, si Meta contesto con un error (o no contesto a tiempo). */
  liveError: string | null;
}

/** Lo que la pantalla usa del alcance en vivo: lo mismo que antes se calculaba en la pagina. */
export function accountReachOf(live: LiveResult<UniqueReach> | null): AccountReach {
  return {
    uniqueReach: live?.ok ? live.data.reach : null,
    uniqueFrequency: live?.ok ? live.data.frequency : null,
    liveError: live && !live.ok ? live.error : null,
  };
}

/** El alcance del periodo anterior, para que la variacion compare lo mismo con lo mismo. Null si Meta no lo dio. */
export function previousReachOf(live: LiveResult<UniqueReach> | null): LiveReach | null {
  return live?.ok ? live.data : null;
}

/** Lo que trae el alcance del dashboard: el del periodo y el del anterior. */
export interface DashboardReach {
  current: AccountReach;
  previous: LiveReach | null;
}

/**
 * Una promesa que nunca rechaza: si algo lanza, devuelve lo que diga `fallback` (y lo anota sin datos sensibles).
 * Es lo que se le pasa a `use()`.
 */
export function neverRejects<T>(promise: Promise<T>, label: string, fallback: (message: string) => T): Promise<T> {
  return promise.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ads] no pude cargar ${label}:`, message);
    return fallback(message);
  });
}
