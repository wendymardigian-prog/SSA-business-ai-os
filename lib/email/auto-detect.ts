/**
 * Detectar correos automaticos (F63).
 *
 * Una respuesta automatica de vacaciones, un rebote o un boletin NO son un
 * lead escribiendo. Tratarlos como tales hace tres cosas malas: crea un
 * contacto que no existe, dispara flows que le contestan a un buzon que no
 * lee nadie, y ensucia las metricas de conversaciones nuevas.
 *
 * Se guardan igual, porque un rebote es informacion util (esa direccion no
 * anda). Lo que no hacen es crear contacto ni disparar nada.
 *
 * Las señales son las del estandar (RFC 3834) mas los remitentes que en la
 * practica siempre son automaticos.
 */

/** Direcciones que nunca son una persona. */
const AUTOMATIC_SENDERS = [
  "no-reply",
  "noreply",
  "no_reply",
  "do-not-reply",
  "donotreply",
  "mailer-daemon",
  "postmaster",
  "bounce",
  "notifications@",
  "automated",
];

/** Valores de `Precedence` que marcan correo masivo o automatico. */
const BULK_PRECEDENCE = ["bulk", "auto_reply", "list", "junk"];

export interface EmailHeaders {
  from?: string | null;
  subject?: string | null;
  /** Las cabeceras crudas, en minuscula. */
  raw?: Record<string, string | undefined> | null;
}

export interface AutoDetection {
  automatic: boolean;
  /** Por que se considero automatico. Para el log y la pantalla. */
  reason: string | null;
}

export function detectAutomatic(headers: EmailHeaders): AutoDetection {
  const raw = normalizeHeaders(headers.raw);

  // RFC 3834: `Auto-Submitted` distinto de `no` es, por definicion, un
  // mensaje generado automaticamente.
  const autoSubmitted = raw["auto-submitted"];
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") {
    return { automatic: true, reason: `Auto-Submitted: ${autoSubmitted}` };
  }

  const precedence = raw.precedence?.toLowerCase();
  if (precedence && BULK_PRECEDENCE.includes(precedence)) {
    return { automatic: true, reason: `Precedence: ${precedence}` };
  }

  // Lo manda un gestor de listas: es un boletin, no alguien escribiendo.
  if (raw["list-unsubscribe"] || raw["list-id"]) {
    return { automatic: true, reason: "Viene de una lista de correo" };
  }

  if (raw["x-autoreply"] || raw["x-autorespond"] || raw["x-auto-response-suppress"]) {
    return { automatic: true, reason: "Es una respuesta automatica" };
  }

  const from = (headers.from ?? "").toLowerCase();
  const matched = AUTOMATIC_SENDERS.find((needle) => from.includes(needle));
  if (matched) return { automatic: true, reason: `El remitente es ${matched}` };

  return { automatic: false, reason: null };
}

function normalizeHeaders(
  raw: Record<string, string | undefined> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
  }
  return out;
}
