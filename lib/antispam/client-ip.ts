/**
 * La IP del cliente para los topes por IP. Puro: solo lee encabezados.
 *
 * En producción el pedido llega directo al borde de Railway (no hay CDN adelante), y Railway
 * PISA `X-Real-IP` con la IP real de quien se conecta. `X-Forwarded-For`, en cambio, lo puede
 * mandar el propio cliente: Railway agrega la IP real al FINAL, así que el primer valor es el
 * que eligió quien pide. Tomar el primero dejaba saltear cualquier tope cambiando el encabezado
 * en cada pedido. Por eso gana `X-Real-IP`, y `X-Forwarded-For` queda solo como respaldo
 * (desarrollo local u otro hosting sin `X-Real-IP`).
 *
 * Si un clon se pone detrás de otro proxy (un CDN), ese proxy tiene que mandar la IP real en
 * `X-Real-IP`, o el tope va a contar la IP del CDN.
 */

/** Largo máximo razonable de una IP (IPv6 con zona incluida). Lo que pasa de esto no es una IP. */
const MAX_IP_LENGTH = 64;

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text || text.length > MAX_IP_LENGTH) return null;
  return text;
}

/** La IP del pedido, o null si ningún encabezado la trae. Cada lugar decide su respaldo. */
export function requestIp(headers: Headers): string | null {
  const real = clean(headers.get("x-real-ip"));
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return clean(forwarded.split(",")[0]);
  return null;
}
