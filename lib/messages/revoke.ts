/**
 * Mensajes borrados "para todos" en WhatsApp (00356).
 *
 * LA REGLA: un borrado NO es un mensaje. Es un aviso de que OTRO mensaje ya no
 * existe en WhatsApp. Si siguiera el camino de un mensaje, entraria como un
 * entrante vacio (no leido, flujos, agente), igual que pasaba con las
 * reacciones. Por eso el receptor lo ataja ANTES del camino de los mensajes,
 * marca la fila borrada (`mark_message_deleted_for_everyone`) y devuelve.
 *
 * Como llega en Evolution 2.3.7 (verificado en
 * `whatsapp.baileys.service.ts` de esa version):
 *
 *  - `MESSAGES_EDITED` ("messages.edited"): Evolution manda ahi CUALQUIER
 *    `protocolMessage` que entra por `messages.upsert`, tambien el de borrar
 *    (`type: REVOKE`, que es el 0 del enum: serializado puede venir como 0,
 *    como "REVOKE" o directamente sin `type`). `data` ES el protocolMessage y
 *    su `key` es la del mensaje borrado. El upsert de ese protocolMessage no
 *    se reenvia.
 *  - `MESSAGES_DELETE` ("messages.delete"), dos formas:
 *      · Baileys avisa el borrado: `data` = la key del mensaje borrado mas
 *        `status: "DELETED"` → `{ remoteJid, fromMe, id, participant? }`.
 *      · Se borro por la API (`/chat/deleteMessageForEveryone`): `data` = la
 *        fila de Evolution → `{ id: <id de SU base>, key: { id, ... } }`. Ojo:
 *        ahi `data.id` NO es el id de WhatsApp; el bueno es `data.key.id`.
 *  - `messages.upsert` con un `protocolMessage`: en la 2.3.7 no pasa, pero si
 *    otra version lo manda, se reconoce igual y nunca se guarda como mensaje.
 *
 * Puro.
 */

export const DELETED_MESSAGE_LABEL = "Mensaje eliminado";

/** WhatsApp deja borrar para todos hasta ~2 dias y medio despues. Se ofrece hasta 2 dias, con margen. */
export const WHATSAPP_DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface ParsedRevoke {
  /** El id de WhatsApp del mensaje borrado (el `key.id` que guardamos en `platform_message_id`). */
  targetId: string;
  /** Si el mensaje borrado era nuestro (del telefono del negocio). null = el aviso no lo dice. */
  fromMe: boolean | null;
  /** El chat del mensaje borrado, si viene (puede ser un @lid o un grupo). */
  remoteJid: string | null;
}

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
}

function keyOf(value: unknown): ParsedRevoke | null {
  const key = asObject(value);
  if (!key) return null;
  const id = typeof key.id === "string" ? key.id.trim() : "";
  if (!id) return null;
  return {
    targetId: id,
    fromMe: typeof key.fromMe === "boolean" ? key.fromMe : null,
    remoteJid: typeof key.remoteJid === "string" && key.remoteJid ? key.remoteJid : null,
  };
}

/** El `type` de un protocolMessage que quiere decir "borrar para todos". */
function isRevokeType(type: unknown): boolean {
  return type === undefined || type === null || type === 0 || type === "REVOKE" || type === "0";
}

/**
 * Si este protocolMessage es un borrado, a que mensaje. Una edicion (trae
 * `editedMessage`, tipo 14) u otro aviso del protocolo (ajustes de mensajes
 * temporales, sincronizacion de historial...) no es un borrado.
 */
export function revokeFromProtocolMessage(protocol: unknown): ParsedRevoke | null {
  const p = asObject(protocol);
  if (!p) return null;
  if (p.editedMessage != null) return null;
  if (!isRevokeType(p.type)) return null;
  return keyOf(p.key);
}

/** El protocolMessage de un mensaje de Baileys (el de `data.message`), si es uno. */
export function protocolMessageOf(message: unknown): Obj | null {
  const m = asObject(message);
  if (!m) return null;
  return asObject(m.protocolMessage);
}

/**
 * Lo que dice un evento de Evolution sobre un borrado: el mensaje borrado, o
 * null si el evento no es un borrado. `event` ya normalizado
 * ("messages.delete", "messages.edited", "messages.upsert").
 */
export function parseWhatsappRevoke(event: string, data: unknown): ParsedRevoke | null {
  const d = asObject(data);
  if (!d) return null;

  if (event === "messages.delete") {
    // La fila de Evolution (borrado por la API): el id bueno esta en `key`.
    if (asObject(d.key)) return keyOf(d.key);
    // La key del mensaje borrado, desparramada.
    return keyOf(d);
  }

  if (event === "messages.edited") {
    return revokeFromProtocolMessage(d);
  }

  if (event === "messages.upsert") {
    return revokeFromProtocolMessage(protocolMessageOf(d.message));
  }

  return null;
}

export type DeletedSource = "contact" | "business" | "app";

/** Quien lo borro, segun el aviso: lo nuestro lo borro el negocio; lo del contacto, el contacto. */
export function revokeSource(revoke: Pick<ParsedRevoke, "fromMe">, fallbackFromMe: boolean): DeletedSource {
  const fromMe = revoke.fromMe ?? fallbackFromMe;
  return fromMe ? "business" : "contact";
}

// ── El mensaje guardado ─────────────────────────────────────────────────────

export interface DeletableMessage {
  deleted_for_everyone_at?: string | null;
}

export function isDeletedForEveryone(message: DeletableMessage | null | undefined): boolean {
  return Boolean(message?.deleted_for_everyone_at);
}

/** Saca los mensajes borrados: el agente y el resumen no los leen como contexto. */
export function withoutDeletedMessages<T extends DeletableMessage>(rows: T[]): T[] {
  return rows.filter((row) => !isDeletedForEveryone(row));
}

export interface DeletedBubbleView {
  label: string;
  /** Quien lo borro, en una frase. */
  detail: string;
  /** Si hay algo guardado para mostrar con «Ver lo que decia». */
  hasOriginal: boolean;
}

/** Como se ve la burbuja de un mensaje borrado. null si no esta borrado. */
export function deletedBubbleView(message: {
  direction: "inbound" | "outbound";
  deleted_for_everyone_at?: string | null;
  deleted_for_everyone_source?: string | null;
  text?: string | null;
  attachments?: unknown;
  transcript?: string | null;
}): DeletedBubbleView | null {
  if (!isDeletedForEveryone(message)) return null;
  const source = message.deleted_for_everyone_source;
  const detail =
    source === "app"
      ? "Lo eliminó alguien del equipo desde acá."
      : source === "business"
        ? "Se eliminó desde el WhatsApp del negocio."
        : source === "contact"
          ? "Lo eliminó el contacto."
          : message.direction === "inbound"
            ? "Lo eliminó el contacto."
            : "Se eliminó desde el WhatsApp del negocio.";
  const hasOriginal = Boolean(
    (message.text && message.text.trim()) || (message.transcript && message.transcript.trim()) || (message.attachments != null),
  );
  return { label: DELETED_MESSAGE_LABEL, detail, hasOriginal };
}

export type DeleteCheck = { ok: true } | { ok: false; reason: string };

/**
 * Si se ofrece «Eliminar para todos» en ESTE mensaje: solo WhatsApp (Evolution,
 * rama explicita), solo lo que mandamos nosotros y salio, con su id de WhatsApp,
 * dentro de la ventana de WhatsApp y que no este ya borrado.
 */
export function canDeleteForEveryone(args: {
  provider: string | null | undefined;
  direction: "inbound" | "outbound";
  status: string | null | undefined;
  platformMessageId: string | null | undefined;
  createdAt: string;
  deletedAt?: string | null;
  now?: Date;
}): DeleteCheck {
  switch (args.provider) {
    case "evolution":
      break;
    case "zernio":
      return { ok: false, reason: "Instagram no deja eliminar mensajes desde acá." };
    case "resend":
      return { ok: false, reason: "Un email enviado no se puede eliminar." };
    default:
      return { ok: false, reason: "Este canal no deja eliminar mensajes." };
  }
  if (args.deletedAt) return { ok: false, reason: "Este mensaje ya se eliminó." };
  if (args.direction !== "outbound") return { ok: false, reason: "Solo se pueden eliminar los mensajes que mandamos nosotros." };
  if (args.status === "failed" || args.status === "pending") return { ok: false, reason: "Este mensaje no llegó a salir." };
  if (!args.platformMessageId) return { ok: false, reason: "Este mensaje todavía no tiene un identificador de WhatsApp." };
  const sentAt = new Date(args.createdAt).getTime();
  if (!Number.isFinite(sentAt)) return { ok: false, reason: "No sé cuándo salió este mensaje." };
  const now = (args.now ?? new Date()).getTime();
  if (now - sentAt > WHATSAPP_DELETE_WINDOW_MS) {
    return { ok: false, reason: "WhatsApp solo deja eliminar para todos durante los primeros dos días." };
  }
  return { ok: true };
}
