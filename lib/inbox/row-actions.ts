/**
 * El menu "⋯" de cada fila de la lista de chats: lo que se puede hacer con una
 * conversacion SIN abrirla. Sirve sobre todo para marcar a un conocido o a un
 * cliente desde la lista (quien lo ve no necesita entrar al chat, y abrirlo lo
 * marcaria como leido).
 *
 * Mismas reglas que la cabecera del chat (`planHeaderActions`): marcar pide
 * `contacts.edit`; quitar, haberla puesto o `contacts.delete`.
 *
 * Puro: lo prueba un test y el componente solo lo dibuja.
 */

import { canUnmarkKnown } from "./known";
import type { MarkFlags } from "./marks";

export type RowAction = "markKnown" | "unmarkKnown" | "markCustomer" | "unmarkCustomer" | "openContact";

export function planRowActions(input: {
  contactId: string | null;
  contact: MarkFlags | null | undefined;
  viewerId: string;
  canEditContacts: boolean;
  canDeleteContacts: boolean;
}): RowAction[] {
  if (!input.contactId) return [];
  const c = input.contact ?? {};
  const actions: RowAction[] = [];
  const canUnmark = (markedBy: string | null | undefined) =>
    input.canEditContacts && canUnmarkKnown({ viewerId: input.viewerId, markedBy: markedBy ?? null, canDeleteContacts: input.canDeleteContacts });

  if (c.is_customer) {
    if (canUnmark(c.customer_marked_by)) actions.push("unmarkCustomer");
  } else if (input.canEditContacts) actions.push("markCustomer");

  if (c.is_known) {
    if (canUnmark(c.known_marked_by)) actions.push("unmarkKnown");
  } else if (input.canEditContacts) actions.push("markKnown");

  actions.push("openContact");
  return actions;
}
