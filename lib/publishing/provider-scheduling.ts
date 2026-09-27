/**
 * Que publicadores agendan de su lado (grupo D).
 *
 * Modulo hoja a proposito: lo consulta la Server Action que programa, y no
 * tiene que arrastrar el registro de publicadores —ni el SDK de Zernio— para
 * responder una pregunta que es una constante.
 */

export const PROVIDER_SCHEDULED_PUBLISHERS = ["zernio"] as const;

/**
 * Si la fecha la maneja el proveedor.
 *
 * Cuando es que si, no hay job de publicacion: el post vive agendado alla y
 * el estado vuelve por webhook. Eso saca del medio a nuestro cron, que es de
 * donde salian el job huerfano al reprogramar, las filas trabadas y los
 * reintentos que podian duplicar.
 */
export function schedulesOnProvider(publisher: string | null | undefined): boolean {
  return PROVIDER_SCHEDULED_PUBLISHERS.includes(publisher as never);
}
