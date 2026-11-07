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
  | "already_replied"
  | "buttons_not_allowed"
  | "not_thread_owner"
  | "outside_window"
  | "rate_limited"
  | "user_unavailable"
  | "token_expired"
  | "policy_violation"
  | "temporary"
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

/**
 * Si otra app es la "duena" del hilo (handover de Meta).
 *
 * Cuando otra app conectada a la cuenta de Instagram (ManyChat, por ejemplo)
 * es la que recibe los mensajes, los nuestros llegan en "standby" y Meta
 * rechaza todo lo que mandemos: un texto, un adjunto o una reaccion. Zernio lo
 * contesta con 409 y `code: "not_thread_owner"` (subcodigo de Meta 2534037,
 * y a veces `details.ownerAppId`). Su SDK se queda con el codigo (texto), el
 * status y `details`, pero descarta el error crudo de Meta. Un 409 suelto NO
 * alcanza: Zernio tambien lo usa para un `Idempotency-Key` en curso.
 */
const NOT_THREAD_OWNER_SUBCODE = 2534037;

function isNotThreadOwner(error: unknown, meta: MetaErrorShape, text: string): boolean {
  if (meta.error_subcode === NOT_THREAD_OWNER_SUBCODE) return true;
  if (error && typeof error === "object") {
    const obj = error as { code?: unknown; details?: { ownerAppId?: unknown } | null };
    if (obj.code === "not_thread_owner") return true;
    if (obj.details && typeof obj.details === "object" && obj.details.ownerAppId != null) return true;
  }
  return (
    text.includes("not_thread_owner") ||
    text.includes("thread owner") ||
    text.includes("thread control") ||
    text.includes("standby")
  );
}

const OUTSIDE_WINDOW_SUBCODES = new Set([2534022, 2018278]);

/**
 * Un subcodigo de Meta que Zernio deja dentro de `details` (su SDK descarta el error crudo, pero a veces copia el
 * subcodigo ahi). Se mira ademas del que trae el error de Meta propiamente dicho.
 */
function detailsSubcode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const d = details as Record<string, unknown>;
  for (const key of ["error_subcode", "errorSubcode", "subcode"]) {
    const value = d[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return undefined;
}

/** El status HTTP que deja el SDK de Zernio (`statusCode`), si lo hay. */
function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : undefined;
}

/**
 * Instagram rechaza un mensaje con botones a quien no sigue la cuenta (codigo 2, subcodigo 1545133). Ese intento puede
 * gastar la unica respuesta privada del comentario, asi que no se reintenta.
 */
const BUTTONS_NOT_ALLOWED_SUBCODE = 1545133;
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/**
 * Devuelve el motivo del rechazo en castellano.
 *
 * Reconoce por codigo cuando lo hay, y por texto cuando Zernio no lo propaga.
 */
export function describeSendError(error: unknown): FriendlyError {
  const meta = extractMetaError(error);
  const text = (meta.message ?? "").toLowerCase();
  const subcode = meta.error_subcode ?? detailsSubcode(error);

  // Instagram deja UNA respuesta privada por comentario. Si otra app (ManyChat, por ejemplo) contesto primero, la
  // nuestra ya no sale y reintentar no sirve.
  if (
    text.includes("private reply has already been sent") ||
    text.includes("one private reply per comment") ||
    text.includes("already replied privately")
  ) {
    return {
      kind: "already_replied",
      message:
        "Este comentario ya tenia una respuesta por privado: otra app (por ejemplo ManyChat) contesto primero. Instagram deja una sola.",
      hint: "Si otra app tiene una automatizacion con la misma palabra, conviene apagarla alla para que conteste el sistema.",
      retryable: false,
    };
  }

  if (
    subcode === BUTTONS_NOT_ALLOWED_SUBCODE ||
    ((text.includes("button") || text.includes("template")) && text.includes("follow"))
  ) {
    return {
      kind: "buttons_not_allowed",
      message: "Instagram rechazo los botones porque la persona no sigue la cuenta.",
      hint: "Instagram puede rechazar los botones a quien no sigue la cuenta, y ese intento gasta la respuesta privada del comentario.",
      retryable: false,
    };
  }

  if (isNotThreadOwner(error, { ...meta, error_subcode: subcode }, text)) {
    return {
      kind: "not_thread_owner",
      message: "Instagram no dejo enviar: esta conversacion la esta manejando otra app conectada a la cuenta (por ejemplo ManyChat).",
      hint: "Mientras esa app tenga la conversacion, Instagram no deja que el sistema responda. Hay que contestar desde esa app o desde Instagram, o pasarle la conversacion al sistema.",
      retryable: false,
    };
  }

  const outsideWindow =
    (subcode !== undefined && OUTSIDE_WINDOW_SUBCODES.has(subcode)) ||
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

  const status = httpStatus(error);
  if (status !== undefined && status >= 500) {
    return {
      kind: "temporary",
      message: "Instagram o Zernio no respondieron bien en ese momento.",
      hint: "Suele ser pasajero: el sistema lo reintenta solo.",
      retryable: true,
    };
  }

  return {
    kind: "unknown",
    message: "No se pudo enviar el mensaje por Instagram.",
    hint: "El sistema lo va a reintentar. Si se repite, conviene revisar el estado del canal.",
    retryable: true,
  };
}

/**
 * Si el motor puede reintentar solo, sin que nadie lo mire. Solo lo que es claramente pasajero: un motivo desconocido
 * no, porque en una respuesta privada un intento de mas puede gastar la unica que Instagram deja.
 */
export function canAutoRetry(kind: InstagramErrorKind): boolean {
  return kind === "rate_limited" || kind === "temporary";
}

/** Motivo cuando el freno lo puso el sistema, no la API. */
export const RATE_LIMIT_REACHED: FriendlyError = {
  kind: "rate_limited",
  message: "Se llego al tope de mensajes automatizados de esta hora.",
  hint: "Instagram permite hasta 200 mensajes automatizados por hora. El envio se retoma en la proxima hora.",
  retryable: true,
};
