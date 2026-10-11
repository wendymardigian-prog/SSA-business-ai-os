/**
 * El aviso de una respuesta nueva (F18). PURO: decide a quién y qué texto; quien
 * lo escribe es `createNotification`, que nunca lanza.
 *
 * Sin personas elegidas, el aviso va a Owner y Admin (`recipientId` vacío, como
 * el resto de los avisos del sistema). Con personas elegidas, uno por cada una.
 * El texto no lleva respuestas, emails ni teléfonos: la campana no es un lugar
 * para datos personales.
 */

export interface NotifySettings {
  notifyEnabled: boolean;
  notifyUserIds: string[];
}

/** `null` = Owner y Admin. Lista vacía = no avisar. */
export function notifyRecipients(settings: NotifySettings): Array<string | null> {
  if (!settings.notifyEnabled) return [];
  const ids = [...new Set(settings.notifyUserIds.filter((id) => typeof id === "string" && id !== ""))];
  return ids.length > 0 ? ids : [null];
}

export type ContactOutcome = "created" | "linked" | "none";

export function contactOutcome(input: { contactId: string | null; contactCreated: boolean }): ContactOutcome {
  if (!input.contactId) return "none";
  return input.contactCreated ? "created" : "linked";
}

const OUTCOME_TEXT: Record<ContactOutcome, string> = {
  created: "Se creó un contacto nuevo con esta respuesta.",
  linked: "Se vinculó con un contacto que ya existía.",
  none: "No dejó email ni teléfono, así que no se creó ningún contacto.",
};

export function notificationContent(input: { formName: string; type: "custom" | "survey" | "contract"; outcome: ContactOutcome }): { title: string; body: string } {
  const name = input.formName.trim() || "Formulario";
  const title = input.type === "survey" ? `Nueva respuesta a la encuesta «${name}»` : `Nueva respuesta en «${name}»`;
  return { title, body: OUTCOME_TEXT[input.outcome] };
}
