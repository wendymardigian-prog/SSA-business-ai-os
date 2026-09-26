/**
 * Armar una respuesta de email (F65).
 *
 * Tres cabeceras hacen la diferencia entre "una respuesta" y "un mail
 * suelto que llegó aparte": el asunto con `Re:`, el `In-Reply-To` y el
 * `References`. Sin las dos ultimas, Gmail y Outlook muestran la respuesta
 * fuera del hilo, y la otra persona ve dos conversaciones separadas.
 *
 * Modulo puro. Enviar es de `lib/messages/outbound.ts` y de la rama
 * `resend` de los dos lugares que mandan mensajes.
 */

/** Cuantos Message-ID se conservan en References. */
export const MAX_REFERENCES = 20;

/**
 * El asunto de la respuesta.
 *
 * `Re:` una sola vez: "Re: Re: Re: Consulta" es lo que pasa cuando cada
 * sistema agrega el suyo. Se reconocen las formas de otros idiomas porque
 * un hilo puede empezar en el cliente de la otra persona.
 */
export function replySubject(original: string | null | undefined): string {
  const subject = (original ?? "").trim();
  if (!subject) return "Re: (sin asunto)";

  // Re:, RE:, Re[2]:, RES:, Rép:, Antw:, Aw:, Sv:
  const prefix = /^\s*(re|res|rép|rep|antw|aw|sv)(\[\d+\])?\s*:\s*/i;
  const clean = subject.replace(prefix, "").trim();

  return `Re: ${clean || "(sin asunto)"}`;
}

/**
 * La cadena References de la respuesta.
 *
 * Es la del mensaje al que se responde MAS su propio Message-ID, en orden.
 * Se recorta por el final mas viejo cuando crece: los clientes de correo
 * arman el hilo con los ultimos, y una cabecera de cincuenta ids es una
 * cabecera que algunos servidores truncan por su cuenta.
 */
export function buildReferences(params: {
  previousReferences: string | null | undefined;
  inReplyTo: string | null | undefined;
}): string | null {
  const previous = (params.previousReferences ?? "")
    .split(/\s+/)
    .map((id) => id.trim())
    .filter(Boolean);

  const inReplyTo = (params.inReplyTo ?? "").trim();
  const all = inReplyTo ? [...previous, inReplyTo] : previous;

  // Sin repetir y sin perder el primero, que es el que abre el hilo.
  const unique = [...new Set(all)];
  if (unique.length === 0) return null;

  if (unique.length <= MAX_REFERENCES) return unique.join(" ");
  return [unique[0], ...unique.slice(-(MAX_REFERENCES - 1))].join(" ");
}

export interface ReplyHeaders {
  subject: string;
  inReplyTo: string | null;
  references: string | null;
}

/** Las tres cabeceras de la respuesta, a partir del ultimo entrante. */
export function replyHeaders(last: {
  subject: string | null;
  messageId: string | null;
  references: string | null;
}): ReplyHeaders {
  return {
    subject: replySubject(last.subject),
    inReplyTo: last.messageId,
    references: buildReferences({
      previousReferences: last.references,
      inReplyTo: last.messageId,
    }),
  };
}

/**
 * El cuerpo en HTML.
 *
 * Simple a proposito: los clientes de correo rompen casi todo el CSS, y lo
 * que se manda es texto que alguien escribio en la bandeja. Lo unico que
 * hace falta es respetar los saltos de linea y escapar lo que podria
 * romper el HTML.
 */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  return `<div style="font-family: -apple-system, system-ui, sans-serif; font-size: 15px; line-height: 1.5;">\n${paragraphs}\n</div>`;
}

export type ReplyCheck = { ok: true } | { ok: false; error: string };

/**
 * Si se puede responder este email.
 *
 * El aviso de "no contactar" es el que importa: mandarle un mail a alguien
 * que pidio que no le escriban es exactamente lo que la marca existe para
 * evitar.
 */
export function canReply(params: {
  channelPlatform: string;
  channelActive: boolean;
  contactOptedOut: boolean;
  toAddress: string | null;
}): ReplyCheck {
  if (params.channelPlatform !== "email") {
    return { ok: false, error: "Esta conversacion no es de email" };
  }
  if (!params.channelActive) {
    return { ok: false, error: "El canal de email esta desconectado" };
  }
  if (!params.toAddress) {
    return { ok: false, error: "No se a que direccion responder" };
  }
  if (params.contactOptedOut) {
    return {
      ok: false,
      error: "Este contacto pidio que no le escriban. Sacale la marca si es un error.",
    };
  }
  return { ok: true };
}

/** La direccion sola, sin el nombre: `Ana <ana@x.com>` → `ana@x.com`. */
export function bareAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /<([^>]+)>/.exec(value);
  const address = (match ? match[1] : value).trim();
  return address.includes("@") ? address.toLowerCase() : null;
}
