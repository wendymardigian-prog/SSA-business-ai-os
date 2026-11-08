/**
 * La lógica de la pestaña IA del editor (F31): qué se ve y qué pasa con cada
 * tecla y cada respuesta. El componente (`components/designer/ai/ai-panel.tsx`)
 * solo la compone.
 *
 * Módulo puro.
 */

import type { AiAttachment } from "@/lib/ai-threads/schema";
import type { PanelMessage } from "../ai/action-types";
import { FORMATS, isPrintFormat, type FormatKey } from "../formats";

/** Cuántas imágenes se pueden adjuntar a un pedido. */
export const MAX_PANEL_ATTACHMENTS = 5;
/** Una imagen adjunta pesa hasta 20 MB (el mismo tope que subir una imagen al diseño). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const COMPOSER_PLACEHOLDER = "Ej.: más grande el título, cambiá el fondo, agregá una lámina con un testimonio";
export const EMPTY_CONVERSATION = "Pedile a la IA lo que quieras cambiar.";
export const STYLE_HINT = "Es un punto de partida, no un límite";
export const WORKING_LABEL = "Diseñando…";

/** Las sugerencias rápidas según el formato (y si es una plantilla). */
export function suggestionsFor(input: { format: FormatKey; isTemplate: boolean; pageCount: number }): string[] {
  const group = FORMATS[input.format].group;
  if (input.isTemplate) {
    return isPrintFormat(input.format) ? ["Más espacio para nombres largos", "Agregá un sello dorado", "Versión en inglés"] : ["Más espacio para nombres largos", "Probá otra paleta", "Más grande el título"];
  }
  if (group === "web") return ["Agregá una sección de testimonios", "Cambiá los colores", "Acortá los textos"];
  if (group === "impreso") return ["Más aire entre los párrafos", "Probá otra tipografía", "Acortá los textos"];
  if (input.pageCount > 1) return ["Hacé la portada más llamativa", "Agregá 2 láminas más", "Acortá los textos"];
  return ["Probá otra paleta", "Más grande el título"];
}

export interface ScopeOption {
  value: number | null;
  label: string;
}

/** «Sobre: Todo / Solo la página N». Con una sola página no hay nada que elegir. */
export function scopeOptions(currentPage: number, pageCount: number): ScopeOption[] {
  if (pageCount <= 1) return [{ value: null, label: "Todo" }];
  return [
    { value: null, label: "Todo" },
    { value: currentPage, label: `Solo la página ${currentPage + 1}` },
  ];
}

/** Si el alcance elegido sigue valiendo cuando la persona cambia de página o de documento. */
export function normalizeScope(scope: number | null, pageCount: number): number | null {
  return scope !== null && scope >= 0 && scope < pageCount ? scope : null;
}

export type KeyAction = "send" | "newline" | "none";

/** Enter envía; Shift+Enter hace una línea nueva; mientras se compone un acento o un teclado IME no hace nada. */
export function keyAction(event: { key: string; shiftKey: boolean; isComposing?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): KeyAction {
  if (event.key !== "Enter" || event.isComposing) return "none";
  if (event.shiftKey) return "newline";
  if (event.ctrlKey || event.metaKey || event.altKey) return "none";
  return "send";
}

export interface ComposerInput {
  text: string;
  attachments: number;
  busy: boolean;
  uploading: boolean;
  aiConnected: boolean;
}

export type ComposerState = { canSend: true } | { canSend: false; reason: string | null };

/** Si se puede enviar y, si no, por qué (sin motivo = simplemente todavía no hay nada que enviar). */
export function composerState(input: ComposerInput): ComposerState {
  if (!input.aiConnected) return { canSend: false, reason: "Conectá una clave de IA en Configuración" };
  if (input.busy) return { canSend: false, reason: "La IA está trabajando" };
  if (input.uploading) return { canSend: false, reason: "Subiendo la imagen…" };
  if (!input.text.trim() && input.attachments === 0) return { canSend: false, reason: null };
  return { canSend: true };
}

/** Valida una imagen elegida del disco antes de subirla (el servidor la vuelve a validar por sus bytes). */
export function checkPickedImage(file: { type: string; size: number; name: string }, already: number): string | null {
  if (already >= MAX_PANEL_ATTACHMENTS) return `Se pueden adjuntar hasta ${MAX_PANEL_ATTACHMENTS} imágenes por pedido.`;
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) return "Usá PNG o JPG (también WebP).";
  if (file.size > MAX_ATTACHMENT_BYTES) return "La imagen pesa más de 20 MB.";
  return null;
}

/** Un adjunto que el panel todavía no envió: lo subido y un link para verlo. */
export interface PendingAttachment extends AiAttachment {
  previewUrl?: string;
}

export function toAttachment(uploaded: { path: string; name: string; mime: string }): PendingAttachment {
  return { asset_path: uploaded.path, name: uploaded.name, mime: uploaded.mime };
}

export type BubbleKind = "user" | "assistant" | "error";

export interface BubbleView {
  id: string;
  kind: BubbleKind;
  text: string;
  /** «Sobre la página 3» en el pedido de la persona. */
  scopeLabel: string | null;
  attachmentNames: string[];
  /** «Cambió la página 3», la línea de lo que hizo la respuesta. */
  did: string | null;
  warnings: string[];
  proposal: PanelMessage["proposal"];
}

/** Cómo se dibuja un mensaje. Un error de la respuesta se ve como error, no como una respuesta común. */
export function bubbleFor(message: PanelMessage): BubbleView {
  const isError = message.role === "assistant" && !!message.error;
  return {
    id: message.id,
    kind: message.role === "user" ? "user" : isError ? "error" : "assistant",
    text: message.content,
    scopeLabel: message.role === "user" && message.scopePage !== null ? `Sobre la página ${message.scopePage + 1}` : null,
    attachmentNames: message.attachments.map((a) => a.name),
    did: message.role === "assistant" ? message.summary : null,
    warnings: message.warnings,
    proposal: message.proposal,
  };
}

/** El texto de un estado de propuesta ya respondida. */
export function proposalStatusLabel(status: "pending" | "accepted" | "declined"): string | null {
  if (status === "accepted") return "Hecho";
  if (status === "declined") return "Lo dejé como estaba";
  return null;
}

/** Si el pedido sigue sin respuesta (el último mensaje es de la persona). */
export function isWaiting(messages: readonly PanelMessage[]): boolean {
  return messages.some((m) => m.pending);
}

/** Cada cuánto se vuelve a mirar la conversación mientras la IA trabaja (ms), y cuándo deja de mirar tan seguido. */
export function pollDelayMs(waitingMs: number): number {
  return waitingMs < 60_000 ? 2_500 : waitingMs < 5 * 60_000 ? 5_000 : 15_000;
}

/**
 * Las respuestas nuevas de la IA que dejaron cambios guardados: es cuando el
 * editor tiene que volver a leer el documento. `seen` son los ids que ya se
 * vieron (la primera carga los marca a todos para no recargar por lo viejo).
 */
export function newlyApplied(seen: ReadonlySet<string>, messages: readonly PanelMessage[]): PanelMessage[] {
  return messages.filter((m) => m.role === "assistant" && !seen.has(m.id) && m.changedPages.length > 0 && !m.error);
}

/** Un error de red o del servidor al llamar una acción, dicho en simple. */
export function actionErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (/body exceeded|too large|413/i.test(text)) return "El archivo pesa más de lo que admite el servidor.";
  return "No pude hacerlo ahora. Probá de nuevo.";
}
