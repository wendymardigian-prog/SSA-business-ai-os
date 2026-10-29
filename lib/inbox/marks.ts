/**
 * Las marcas propias del contacto: "Conocido" (00256) y "Cliente" (00268).
 *
 * Las dos hacen lo mismo (apagan el agente, pausan secuencias, mandan los chats
 * a una persona por cuenta y muestran un aviso antes de abrir el chat); cambian
 * el texto, el color y a quien van los chats sin nada configurado (un conocido
 * va al Owner; un cliente se queda con su responsable).
 *
 * Puro: lo usan la bandeja, la ficha y los tests. Las reglas del conocido viven
 * en `known.ts` (no se tocaron); esto suma las del cliente y lo que es comun.
 */

import { canUnmarkKnown, knownLabel, parseKnownSettings } from "./known";

export type ContactMark = "known" | "customer";

/** Lo que la pantalla necesita saber de las marcas de un contacto. */
export interface MarkFlags {
  is_known?: boolean | null;
  known_marked_by?: string | null;
  is_customer?: boolean | null;
  customer_marked_by?: string | null;
  customer_source?: string | null;
}

/** Las marcas que tiene, en el orden en que se muestran. */
export function contactMarks(c: MarkFlags | null | undefined): ContactMark[] {
  if (!c) return [];
  const marks: ContactMark[] = [];
  if (c.is_customer) marks.push("customer");
  if (c.is_known) marks.push("known");
  return marks;
}

/** Quien puso la marca (null si vino sola, por un cobro). */
export function markedBy(c: MarkFlags, mark: ContactMark): string | null {
  return (mark === "known" ? c.known_marked_by : c.customer_marked_by) ?? null;
}

/** "Cliente de Ana", "Cliente (compró)", "Cliente". */
export function customerLabel(markedByName: string | null, source?: string | null): string {
  if (markedByName) return `Cliente de ${markedByName}`;
  return source === "sale" ? "Cliente (compró)" : "Cliente";
}

/** El texto largo de una marca, con quien la puso. */
export function markLabel(mark: ContactMark, markedByName: string | null, source?: string | null): string {
  return mark === "known" ? knownLabel(markedByName) : customerLabel(markedByName, source);
}

/** El texto corto (la etiqueta de la lista). */
export const MARK_SHORT: Record<ContactMark, string> = { known: "Conocido", customer: "Cliente" };

/** Quien puede quitar una marca: quien la puso o quien puede borrar contactos. */
export function canUnmarkMark(input: { viewerId: string; markedBy: string | null; canDeleteContacts: boolean }): boolean {
  return canUnmarkKnown(input);
}

/**
 * El aviso antes de abrir el chat: la primera marca por la que quien mira NO es
 * quien la puso ni el responsable del chat. null = se abre directo.
 */
export function markGate(c: MarkFlags | null | undefined, input: { assignedTo: string | null; viewerId: string }): ContactMark | null {
  if (!c) return null;
  for (const mark of contactMarks(c)) {
    const by = markedBy(c, mark);
    if (input.viewerId !== by && input.viewerId !== input.assignedTo) return mark;
  }
  return null;
}

/**
 * A quien va un chat de un cliente: la persona de esa cuenta o la por defecto.
 * Sin nadie configurado, null (el responsable no cambia). Gemela de
 * `private.customer_assignee` (00268).
 */
export function customerAssignee(raw: unknown, channelId: string, memberIds: Iterable<string>): string | null {
  const settings = parseKnownSettings(raw);
  const members = new Set(memberIds);
  for (const candidate of [settings.byChannel[channelId], settings.defaultUserId]) {
    if (candidate && members.has(candidate)) return candidate;
  }
  return null;
}
