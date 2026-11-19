import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Comparaciones que no filtran informacion por el tiempo que tardan.
 *
 * Va en su propio modulo porque la usan los receptores de mensajes (el token
 * de Evolution) y los crons.
 */

/**
 * Compara dos strings en tiempo constante.
 *
 * Con `===` el tiempo de comparacion depende de cuantos caracteres coinciden, y
 * eso alcanza para adivinar un secreto de a un byte.
 *
 * Se comparan los HMAC de los dos valores (con una clave al azar de este
 * proceso), que siempre miden 32 bytes: asi tampoco se filtra el LARGO del
 * secreto, y timingSafeEqual (que lanza con largos distintos) nunca lanza.
 */
const COMPARE_KEY = randomBytes(32);

export function constantTimeEquals(a: string, b: string): boolean {
  const macA = createHmac("sha256", COMPARE_KEY).update(a, "utf8").digest();
  const macB = createHmac("sha256", COMPARE_KEY).update(b, "utf8").digest();
  return timingSafeEqual(macA, macB);
}
