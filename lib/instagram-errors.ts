/**
 * Traduce los errores de la API de Meta a algo que se pueda leer en la bandeja.
 *
 * Hasta ahora, cuando Instagram rechazaba un envio, el motor hacia un
 * console.error, marcaba el mensaje como fallido y seguia de largo. En la
 * conversacion quedaba un mensaje en rojo sin ninguna explicacion, y el
 * operador no tenia forma de saber si el problema era el lead, la cuenta o el
 * sistema.
 *
 * La causa mas comun por lejos es la ventana de 24 horas: Meta no deja escribir
 * a alguien que no te contesta hace mas de un dia. Eso no es un error del
 * sistema, es una regla de la plataforma, y el operador tiene que entenderlo
 * asi para saber que hacer (esperar a que conteste, o buscarlo por otro lado).
 *
 * No se intenta adivinar de mas: lo que no se reconoce se devuelve como error
 * generico con la sugerencia de reintentar, nunca con el texto crudo de la API.
 */

/** Motivos que sabemos distinguir. */
export type InstagramErrorKind =
  | "outside_window"
  | "rate_limited"
  | "user_unavailable"
  | "token_expired"
  | "policy_violation"
  | "unknown";

export interface FriendlyError {
  kind: InstagramErrorKind;
  /** Texto para mostrar en la conversacion. Sin jerga, sin codigos. */
  message: string;
  /** Que puede hacer el operador. */
  hint?: string;
  /** Si reintentar mas tarde tiene sentido. */
  retryable: boolean;
}

interface MetaErrorShape {
  code?: number;
  error_subcode?: number;
  message?: string;
  type?: string;
}

/**
 * Saca el error de Meta de adentro de lo que sea que haya tirado el SDK.
 *
 * Zernio envuelve la API de Meta, asi que el error puede venir como Error con
 * el JSON adentro del mensaje, como objeto con `error`, o como respuesta cruda.
 */
function extractMetaError(error: unknown): MetaErrorShape {
  if (!error) return {};

  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;

    const nested = (obj.error ?? obj.response ?? obj.body ?? obj.data) as
      | Record<string, unknown>
      | undefined;
    if (nested && typeof nested === "object") {
      const inner = extractMetaError(nested);
      if (inner.code !== undefined || inner.error_subcode !== undefined || inner.message) {
        return inner;
      }
    }

    // error_subcode cuenta como señal: Meta a veces manda el subcodigo sin un
    // `code` de primer nivel, y ese subcodigo es justamente el que distingue la
    // ventana de 24 horas del resto de los rechazos.
    if (
      typeof obj.code === "number" ||
      typeof obj.error_subcode === "number" ||
      typeof obj.message === "string"
    ) {
      return {
        code: typeof obj.code === "number" ? obj.code : undefined,
        error_subcode:
          typeof obj.error_subcode === "number" ? obj.error_subcode : undefined,
        message: typeof obj.message === "string" ? obj.message : undefined,
        type: typeof obj.type === "string" ? obj.type : undefined,
      };
    }
  }

  if (error instanceof Error) {
    // Algunos SDK meten el JSON de Meta adentro del texto del Error.
    const match = error.message.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return extractMetaError(JSON.parse(match[0]));
      } catch {
        // No era JSON: seguimos con el texto pelado.
      }
    }
    return { message: error.message };
  }

  if (typeof error === "string") return { message: error };
  return {};
}

const OUTSIDE_WINDOW_SUBCODES = new Set([2534022, 2018278]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/**
 * Devuelve el motivo del rechazo en castellano.
 *
 * Reconoce por codigo cuando lo hay, y por texto cuando Zernio no lo propaga.
 */
export function describeSendError(error: unknown): FriendlyError {
  const meta = extractMetaError(error);
  const text = (meta.message ?? "").toLowerCase();

  const outsideWindow =
    (meta.error_subcode !== undefined && OUTSIDE_WINDOW_SUBCODES.has(meta.error_subcode)) ||
    text.includes("outside of allowed window") ||
    text.includes("outside the allowed window") ||
    text.includes("24-hour") ||
    text.includes("24 hour") ||
    text.includes("messaging window");

  if (outsideWindow) {
    return {
      kind: "outside_window",
      message:
        "Instagram no dejo enviar el mensaje: pasaron mas de 24 horas desde la ultima respuesta del contacto.",
      hint: "Instagram solo permite escribir dentro de las 24 horas posteriores al ultimo mensaje del lead. Hay que esperar a que conteste, o buscarlo por otro canal.",
      retryable: false,
    };
  }

  if (
    (meta.code !== undefined && RATE_LIMIT_CODES.has(meta.code)) ||
    text.includes("rate limit") ||
    text.includes("request limit reached") ||
    text.includes("too many requests")
  ) {
    return {
      kind: "rate_limited",
      message: "Instagram esta limitando los envios de la cuenta por ahora.",
      hint: "Se manda demasiado seguido. El sistema va a reintentar mas tarde; si se repite seguido, conviene espaciar las automatizaciones.",
      retryable: true,
    };
  }

  if (
    meta.code === 551 ||
    text.includes("user is not available") ||
    text.includes("cannot receive") ||
    text.includes("not available")
  ) {
    return {
      kind: "user_unavailable",
      message: "El contacto no esta recibiendo mensajes en Instagram.",
      hint: "Puede haber bloqueado la cuenta, desactivado su perfil o restringido quien le escribe.",
      retryable: false,
    };
  }

  if (
    meta.code === 190 ||
    text.includes("access token") ||
    text.includes("session has expired") ||
    text.includes("oauth")
  ) {
    return {
      kind: "token_expired",
      message: "La conexion con Instagram dejo de ser valida.",
      hint: "Hay que volver a conectar la cuenta desde Canales para que el sistema pueda seguir enviando.",
      retryable: false,
    };
  }

  if (meta.code === 10 || text.includes("policy") || text.includes("not allowed")) {
    return {
      kind: "policy_violation",
      message: "Instagram rechazo el mensaje por sus reglas de uso.",
      hint: "Suele pasar con mensajes promocionales fuera de la ventana permitida o con contenido que la plataforma no acepta.",
      retryable: false,
    };
  }

  return {
    kind: "unknown",
    message: "No se pudo enviar el mensaje por Instagram.",
    hint: "El sistema lo va a reintentar. Si se repite, conviene revisar el estado del canal.",
    retryable: true,
  };
}

/** Motivo cuando el freno lo puso el sistema, no la API. */
export const RATE_LIMIT_REACHED: FriendlyError = {
  kind: "rate_limited",
  message: "Se llego al tope de mensajes automatizados de esta hora.",
  hint: "Instagram permite hasta 200 mensajes automatizados por hora. El envio se retoma en la proxima hora.",
  retryable: true,
};
