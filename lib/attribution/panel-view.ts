/**
 * Lo que muestra el bloque «Atribución de links» del panel de «Enviar mensaje» (Extra I, F39). Todo lo que decide
 * QUÉ mostrar vive acá; el componente (`SendMessagePanel`) solo lo compone.
 *
 * Reglas:
 *   - El estado REAL de un nodo sin la clave `attribution` es «apagado» (el motor lee `readNodeAttribution`, que sin la
 *     clave devuelve null). El interruptor muestra eso, para no prometer parámetros que no van a salir. El valor por
 *     defecto del negocio se usa (a) como valor inicial de «Registrar el clic» al prender el primer interruptor y (b) para
 *     sembrar los nodos NUEVOS (ver `newNodeAttribution`).
 *   - No se escribe nada en el nodo hasta que la persona toca un interruptor.
 *   - El ejemplo sale de `describeAttributionExample` con los valores reales del flujo (nombre, id, disparador).
 *
 * Modulo PURO.
 */
import { isNoContactTriggerType } from "@/lib/flow-engine/contact-free";
import { describeAttributionExample, type LinkAttributionContext } from "./link-params";

/** La red de muestra cuando el editor no conoce el canal (un flujo no declara canal). */
export const SAMPLE_PLATFORM = "instagram";
/** El código de pieza de muestra del ejemplo (el real depende de cada pieza). */
export const SAMPLE_PIECE_CODE = "c8k2f";
/** Cómo se llama un flujo que todavía no tiene nombre. */
export const UNNAMED_FLOW = "tu flujo";

export interface NodeAttributionState {
  append: boolean;
  trackClicks: boolean;
}

export interface AttributionDefaults {
  append: boolean;
  trackClicks: boolean;
}

/** Lo que el editor sabe del flujo. */
export interface AttributionPanelInput {
  /** `node.data.attribution` tal cual está guardado (puede faltar o venir raro). */
  attribution: unknown;
  /** Los valores por defecto del negocio (`links_append_default` y `links_track_clicks_default`). */
  defaults: AttributionDefaults;
  flowId: string | null | undefined;
  flowName: string | null | undefined;
  /** La red del canal, si se conoce. Si no, se usa una de muestra. */
  platform?: string | null;
  /** `triggerType` del disparador del flujo. */
  triggerType?: string | null;
  /** El disparador por palabra clave filtra respuestas a historias. */
  storyReply?: boolean;
}

export interface AttributionPanelView {
  /** La clave `attribution` ya está guardada en el nodo. */
  hasKey: boolean;
  append: boolean;
  trackClicks: boolean;
  /** «Registrar el clic» solo se ofrece con el primer interruptor encendido. */
  showTrackClicks: boolean;
  /** El bloque arranca abierto si ya está encendido. */
  startOpen: boolean;
  /** Aviso cuando el negocio lo tiene encendido por defecto pero este nodo todavía no lo usa. */
  businessDefaultHint: string | null;
  params: Array<{ key: string; value: string }>;
  /** «Con un comentario en una pieza, el link». */
  exampleLead: string;
  exampleBefore: string;
  exampleAfter: string;
  /** Qué es `utm_content` en este flujo. */
  contentLine: string;
  /** Si la red del ejemplo es de muestra, lo aclara. */
  sourceNote: string | null;
  /** Solo con «Registrar el clic» encendido. */
  trackNote: string | null;
  /** Solo si el flujo no tiene contacto y «Registrar el clic» está encendido. */
  noContactNote: string | null;
}

/** Lee la config guardada; solo cuenta si trae `append` como booleano. */
export function readStoredAttribution(raw: unknown): NodeAttributionState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as { append?: unknown; trackClicks?: unknown };
  if (typeof a.append !== "boolean") return null;
  return { append: a.append, trackClicks: a.trackClicks === true };
}

/** El `attribution` con el que nace un nodo de envío nuevo: solo si el negocio lo tiene encendido por defecto; si no, nada. */
export function newNodeAttribution(defaults: AttributionDefaults): NodeAttributionState | undefined {
  return defaults.append ? { append: true, trackClicks: defaults.trackClicks } : undefined;
}

/**
 * El `attribution` nuevo cuando la persona toca un interruptor. Al encender el primero con la clave ausente se guarda
 * `{ append: true, trackClicks: <default del negocio> }`. Apagar conserva el valor de «Registrar el clic» (para que al volver
 * a encender quede como estaba).
 */
export function nextAttribution(
  raw: unknown,
  change: { append?: boolean; trackClicks?: boolean },
  defaults: AttributionDefaults,
): NodeAttributionState {
  const stored = readStoredAttribution(raw);
  const trackClicks = change.trackClicks ?? (stored ? stored.trackClicks : defaults.trackClicks);
  const append = change.append ?? stored?.append ?? true;
  return { append, trackClicks };
}

function triggerLabelAndPiece(input: AttributionPanelInput): { label: string; fromPiece: boolean } {
  if (input.triggerType === "comment_keyword") return { label: "un comentario", fromPiece: true };
  if (input.triggerType === "keyword" && input.storyReply === true) return { label: "una respuesta a tu historia", fromPiece: true };
  return { label: "un mensaje", fromPiece: false };
}

/** ¿Este flujo corre sin contacto (webhook, persona del equipo, sistema)? Ahí el link no puede llevar seguimiento. */
export function flowHasNoContact(triggerType: string | null | undefined): boolean {
  return triggerType === "webhook_received" || isNoContactTriggerType(triggerType);
}

export function attributionPanelView(input: AttributionPanelInput): AttributionPanelView {
  const stored = readStoredAttribution(input.attribution);
  const append = stored?.append === true;
  const trackClicks = stored ? stored.trackClicks : input.defaults.trackClicks;

  const platformKnown = Boolean((input.platform ?? "").trim());
  const { label, fromPiece } = triggerLabelAndPiece(input);
  const flowName = (input.flowName ?? "").trim() || UNNAMED_FLOW;

  const ctx: LinkAttributionContext = {
    platform: platformKnown ? input.platform : SAMPLE_PLATFORM,
    // Sin nombre, el ejemplo dice «tu flujo» (su slug); el real cae al código del flujo.
    flowName,
    flowId: input.flowId,
    contentCode: fromPiece ? SAMPLE_PIECE_CODE : null,
  };
  const example = describeAttributionExample({ ctx, triggerLabel: label });

  const cut = example.text.indexOf(", el link");
  const exampleLead = cut > 0 ? example.text.slice(0, cut) : `Con ${label}`;

  const contentLine = fromPiece
    ? `utm_content = el código de la pieza (en el ejemplo, ${SAMPLE_PIECE_CODE}). Lo ves en la ficha de la pieza, en Contenido.`
    : (example.contentNote ?? "");

  const noContact = flowHasNoContact(input.triggerType);

  return {
    hasKey: stored !== null,
    append,
    trackClicks,
    showTrackClicks: append,
    startOpen: append,
    businessDefaultHint:
      !stored && input.defaults.append
        ? "Tu negocio lo tiene encendido por defecto para los nodos nuevos. Este nodo todavía no lo usa: encendelo acá."
        : null,
    params: example.params.map((p) => ({ key: p.key, value: p.value })),
    exampleLead,
    exampleBefore: example.before,
    exampleAfter: example.after,
    contentLine,
    sourceNote: platformKnown
      ? null
      : "Al enviar, utm_source es la red por la que sale el mensaje (instagram, whatsapp, facebook…).",
    trackNote:
      append && trackClicks
        ? "El link que recibe la persona pasa primero por tu sistema, que anota el clic y la manda al destino."
        : null,
    noContactNote:
      append && trackClicks && noContact
        ? "Este flujo no tiene contacto: sin contacto el link sale con parámetros pero sin seguimiento."
        : null,
  };
}

/** Parte un texto con `código` entre acentos graves en pedazos, para pintar los códigos sin mostrar los acentos. */
export function splitCodeSpans(text: string): Array<{ text: string; code: boolean }> {
  return text
    .split("`")
    .map((part, i) => ({ text: part, code: i % 2 === 1 }))
    .filter((part) => part.text !== "");
}
