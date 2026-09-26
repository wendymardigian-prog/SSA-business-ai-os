/**
 * La cuota de Resend (F66).
 *
 * El plan gratis de Resend son 100 emails por dia, y ahi entran las
 * invitaciones al equipo, los avisos y ahora las respuestas de la bandeja.
 * Quedarse sin cuota un martes a la tarde significa que las respuestas de
 * la tarde no salen, y sin aviso nadie se entera hasta que un cliente
 * pregunta por que no le contestaron.
 *
 * Por eso el aviso al 90%, y una vez por dia: diez avisos del mismo
 * problema hacen que se ignoren todos.
 */

/** El tope del plan gratis. Se puede cambiar en la config. */
export const DEFAULT_DAILY_QUOTA = 100;

/** Desde que porcentaje se avisa. */
export const WARN_AT_PERCENT = 90;

export interface QuotaUsage {
  used: number;
  quota: number;
  percent: number;
  remaining: number;
  /** Hay que avisar. */
  shouldWarn: boolean;
  /** Ya no entra ninguno mas. */
  exhausted: boolean;
  label: string;
}

export function computeQuota(params: {
  sentToday: number;
  receivedToday: number;
  quota?: number | null;
}): QuotaUsage {
  const quota = params.quota && params.quota > 0 ? params.quota : DEFAULT_DAILY_QUOTA;
  // Entrada y salida: el plan de Resend cuenta las dos cosas.
  const used = params.sentToday + params.receivedToday;
  const percent = Math.round((used / quota) * 100);

  return {
    used,
    quota,
    percent,
    remaining: Math.max(0, quota - used),
    shouldWarn: percent >= WARN_AT_PERCENT,
    exhausted: used >= quota,
    label:
      used >= quota
        ? `Se agoto la cuota de hoy (${used} de ${quota}). Los emails no van a salir hasta mañana.`
        : percent >= WARN_AT_PERCENT
          ? `Quedan ${quota - used} emails de los ${quota} de hoy.`
          : `${used} de ${quota} emails hoy.`,
  };
}

/**
 * Si corresponde avisar hoy.
 *
 * El aviso es uno por dia: el mismo problema repetido cada hora hace que
 * se ignoren todos los avisos, incluidos los que importan.
 */
export function shouldNotify(params: {
  usage: QuotaUsage;
  lastNotifiedAt: string | null;
  today: string;
}): boolean {
  if (!params.usage.shouldWarn) return false;
  if (!params.lastNotifiedAt) return true;
  return params.lastNotifiedAt.slice(0, 10) !== params.today;
}
