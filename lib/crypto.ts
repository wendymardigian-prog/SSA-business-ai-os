import { timingSafeEqual } from "node:crypto";

/**
 * Comparaciones que no filtran informacion por el tiempo que tardan.
 *
 * Vivia adentro de lib/inbound.ts, que es el modulo de los webhooks entrantes.
 * Ahi estaba bien mientras el unico consumidor era el token de Evolution; con
 * los crons usandola tambien, tenerla en un modulo llamado "inbound" es
 * confuso.
 */

/**
 * Compara dos strings en tiempo constante.
 *
 * Con `===` el tiempo de comparacion depende de cuantos caracteres coinciden, y
 * eso alcanza para adivinar un secreto de a un byte. La diferencia de largo si
 * se filtra, pero eso no ayuda a adivinar el contenido.
 *
 * El chequeo de largo ademas es obligatorio: timingSafeEqual lanza si los
 * buffers no miden lo mismo.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
