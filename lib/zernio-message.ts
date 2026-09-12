/**
 * Traduccion de un mensaje de Zernio al shape que espera la bandeja.
 *
 * Para Instagram los mensajes no viven en nuestra base: el hilo se le pide a
 * Zernio cada vez que alguien abre una conversacion. Esta funcion es el unico
 * lugar donde se interpreta esa respuesta, y esta aparte del route para poder
 * probarla con payloads reales.
 *
 * Tres cosas que la respuesta de Zernio hace y que hay que tener presentes:
 *
 * 1. El texto se llama `message`, no `text`, y en los mensajes de tipo
 *    plantilla (las tarjetas con botones que manda una herramienta de
 *    automatizacion) viene VACIO: el texto real esta adentro del adjunto, en
 *    payload.generic.elements[].title. Sin sacarlo de ahi, la bandeja muestra
 *    "Attachment" y nada mas, que es como estaban 76 de 170 conversaciones.
 * 2. La direccion es "incoming" / "outgoing", no "inbound" / "outbound".
 *    Compararla contra el vocabulario equivocado hacia que TODOS los mensajes
 *    se pintaran como del lead, incluidas nuestras propias respuestas.
 * 3. El tipado del SDK esta incompleto: declara los adjuntos como
 *    image/video/audio/file/sticker/share y no incluye "template", que es
 *    justo el que trae el texto. Por eso aca se navega la respuesta como
 *    `unknown`, con guardas, en vez de confiar en el tipo.
 */

/** Un mensaje tal como lo consume la bandeja (mismo shape que la tabla `messages`). */
export interface InboxMessage {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  attachments: unknown[] | null;
  quick_reply_payload: null;
  postback_payload: null;
  callback_data: null;
  platform_message_id: string | null;
  /** El endpoint de historial de Zernio no devuelve el id nativo de la plataforma. */
  platform_native_message_id: null;
  sent_by_flow_id: null;
  sent_by_node_id: null;
  sent_by_user_id: null;
  status: string;
  created_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * El texto que esconde un adjunto de tipo plantilla.
 *
 * La forma es payload.generic.elements[].title, pero cada salto se comprueba:
 * es una estructura de Meta que el SDK ni siquiera declara, asi que cualquier
 * suposicion de mas termina en una excepcion adentro del render del hilo.
 */
function templateText(attachment: unknown): string {
  if (!isRecord(attachment)) return "";

  const payload = attachment.payload;
  if (!isRecord(payload)) return "";

  const generic = payload.generic;
  if (!isRecord(generic)) return "";

  const elements = generic.elements;
  if (!Array.isArray(elements)) return "";

  // Una tarjeta puede traer varios elementos; se juntan los titulos que haya.
  const titles: string[] = [];
  for (const element of elements) {
    if (!isRecord(element)) continue;
    const title = asString(element.title).trim();
    const subtitle = asString(element.subtitle).trim();
    if (title) titles.push(title);
    if (subtitle) titles.push(subtitle);
  }

  return titles.join("\n\n");
}

/** true si el adjunto es una plantilla (el que trae texto en vez de un archivo). */
function isTemplate(attachment: unknown): boolean {
  return isRecord(attachment) && asString(attachment.type).toLowerCase() === "template";
}

/**
 * El texto visible de un mensaje.
 *
 * El orden importa: primero lo que Zernio manda como texto, y recien si eso
 * viene vacio se busca adentro de las plantillas. Se usa `|| `, no `??`: el
 * campo llega como cadena vacia, no como null, y `"" ?? x` devuelve "".
 */
export function messageText(raw: unknown): string | null {
  if (!isRecord(raw)) return null;

  const direct = asString(raw.message).trim();
  if (direct) return direct;

  const attachments = Array.isArray(raw.attachments) ? raw.attachments : [];
  for (const attachment of attachments) {
    const fromTemplate = templateText(attachment).trim();
    if (fromTemplate) return fromTemplate;
  }

  // Un adjunto de verdad (una imagen, un audio) no tiene texto que mostrar:
  // se devuelve null y la burbuja pinta el adjunto, que es lo correcto.
  return null;
}

/**
 * Los adjuntos que la burbuja tiene que mostrar.
 *
 * Una plantilla cuyo texto ya se esta mostrando deja de ser un adjunto: si se
 * dejara, la burbuja mostraria el texto Y el clip de "Attachment" por la misma
 * cosa.
 */
export function visibleAttachments(raw: unknown, usedAsText: boolean): unknown[] | null {
  if (!isRecord(raw)) return null;

  const attachments = Array.isArray(raw.attachments) ? raw.attachments : [];
  const visible = usedAsText ? attachments.filter((a) => !isTemplate(a)) : attachments;

  return visible.length > 0 ? visible : null;
}

/** "incoming" | "outgoing" de Zernio al vocabulario de la bandeja. */
export function messageDirection(raw: unknown): "inbound" | "outbound" {
  const value = isRecord(raw) ? asString(raw.direction).toLowerCase() : "";
  // Ante la duda, entrante: pintar un mensaje nuestro como del lead confunde
  // menos que atribuirle al lead algo que no dijo.
  return value === "outgoing" || value === "outbound" ? "outbound" : "inbound";
}

export function toInboxMessage(raw: unknown, conversationId: string): InboxMessage {
  const record = isRecord(raw) ? raw : {};

  const text = messageText(record);
  const cameFromTemplate = text !== null && !asString(record.message).trim();

  const created =
    asString(record.createdAt) || asString(record.sentAt) || new Date().toISOString();

  return {
    id: asString(record.id) || `zernio-${created}`,
    conversation_id: conversationId,
    direction: messageDirection(record),
    text,
    attachments: visibleAttachments(record, cameFromTemplate),
    quick_reply_payload: null,
    postback_payload: null,
    callback_data: null,
    platform_message_id: asString(record.id) || null,
    // El endpoint de historial no devuelve el id nativo de la plataforma.
    platform_native_message_id: null,
    sent_by_flow_id: null,
    sent_by_node_id: null,
    sent_by_user_id: null,
    // deliveryStatus es lo que Zernio sabe del envio; "sent" es el default
    // razonable cuando no lo manda.
    status: asString(record.deliveryStatus) || "sent",
    created_at: created,
  };
}

/**
 * Traduce la respuesta entera del hilo.
 *
 * `sortOrderApplied` existe porque hay plataformas donde Zernio no puede
 * respetar el orden pedido. Solo se da vuelta la lista cuando efectivamente
 * vino descendente: invertir a ciegas rompe el hilo en las que ya venian bien.
 */
export function toInboxThread(
  response: unknown,
  conversationId: string,
): InboxMessage[] {
  const data = isRecord(response) && isRecord(response.data) ? response.data : response;
  if (!isRecord(data)) return [];

  const raw = Array.isArray(data.messages)
    ? data.messages
    : Array.isArray(data.data)
      ? data.data
      : [];

  const messages = raw.map((m) => toInboxMessage(m, conversationId));

  const applied = asString(data.sortOrderApplied).toLowerCase();
  return applied === "desc" ? messages.reverse() : messages;
}
