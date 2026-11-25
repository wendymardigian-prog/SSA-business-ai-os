/**
 * Cómo se ven las variables en el selector del lienzo (traído de RER el 25/11/2026): agrupadas («Contacto», «Venta», «Reunión»…) y con
 * un nombre en castellano. PURO: lo usan los paneles del lienzo.
 *
 * El rótulo sale, en este orden, de: el esquema del disparador (el texto de cada pregunta de un formulario, los datos de
 * la reunión…, que llegan con su ruta real), el nombre del campo personalizado, y la lista fija de abajo.
 */

import { aliasFor } from "./variable-aliases";

/** El grupo de cada raíz. Lo que no está acá va a «Pasos anteriores» (lo dejó un paso del flujo). */
const ROOT_GROUPS: Record<string, string> = {
  contact: "Contacto",
  workspace: "Negocio",
  sale: "Venta",
  payment: "Pago",
  booking: "Reunión",
  scheduling: "Agenda",
  form: "Formulario",
  submission: "Formulario",
  answer: "Formulario",
  answer_raw: "Formulario",
  message: "Mensaje",
  comment: "Comentario",
  content: "Comentario",
  email: "Mensaje",
  inactivity: "Inactividad",
  event: "Evento del CRM",
  task: "Tarea",
  service: "Servicio",
  alert: "Servicio",
  dato: "Servicio",
  call: "Grabación",
  group: "Grupo de WhatsApp",
  reaction: "Grupo de WhatsApp",
  poll: "Grupo de WhatsApp",
  schedule: "Fecha programada",
  affiliate: "Afiliado",
  webhook: "Webhook",
  eod: "Fin de día",
  member: "Fin de día",
  metrics: "Fin de día",
  channel: "Fin de día",
  report: "Fin de día",
};

export const CUSTOM_FIELDS_GROUP = "Campos personalizados";
export const PREVIOUS_STEPS_GROUP = "Pasos anteriores";

/** Lo que deja un paso del flujo, aunque su raíz sea `contact.`. */
const STEP_OUTPUTS = new Set(["ai.response", "contact.result", "contact.fail_reason"]);

const KNOWN_LABELS: Record<string, string> = {
  "contact.first_name": "Nombre de pila",
  "contact.display_name": "Nombre completo",
  "contact.name": "Nombre completo",
  "contact.email": "Email",
  "contact.phone": "Teléfono",
  "contact.id": "ID del contacto",
  "contact.secondary_email": "Email secundario",
  "contact.whatsapp": "WhatsApp",
  "contact.instagram": "Usuario de Instagram",
  "contact.tiktok": "Usuario de TikTok",
  "contact.twitter": "Usuario de X",
  "contact.linkedin": "Perfil de LinkedIn",
  "contact.country": "País",
  "contact.timezone": "Zona horaria",
  "contact.tags": "Etiquetas",
  "contact.setter_name": "Setter",
  "contact.vendedor_name": "Vendedor",
  "contact.setter_status": "Estado de setter",
  "contact.vendedor_status": "Estado de vendedor",
  "contact.last_status": "Último estado",
  "contact.qualification": "Calificación",
  "contact.qualification_level": "Nivel de calificación (número)",
  "contact.temperature": "Temperatura",
  "workspace.name": "Nombre del negocio",
  "message.text": "Texto del mensaje",
  "message.origin.ad_id": "ID del anuncio",
  "message.origin.ad_title": "Título del anuncio",
  "message.origin.is_story_mention": "Es una mención en una historia",
  "comment.text": "Texto del comentario",
  "comment.id": "ID del comentario",
  "comment.author_name": "Quién comentó",
  "comment.post_id": "ID de la publicación",
  "content.title": "Título de la publicación",
  "content.code": "Código de la publicación",
  "email.subject": "Asunto del email",
  "inactivity.hours": "Horas sin actividad",
  "event.type": "Tipo de evento",
  "event.source": "Origen del evento",
  "event.tag_name": "Etiqueta",
  "event.value": "Valor",
  "event.role": "Rol",
  "event.reason": "Motivo",
  "event.level": "Nivel nuevo",
  "event.previous_level": "Nivel anterior",
  "ai.response": "Respuesta de la IA",
  "contact.result": "Resultado de «Crear o actualizar contacto»",
  "contact.fail_reason": "Por qué no se pudo crear el contacto",
  "form.name": "Nombre del formulario",
  "form.url": "Link del formulario",
  "form.type": "Tipo de formulario",
  "form.category": "Categoría del formulario",
  "submission.url": "Link a la respuesta",
  "submission.created_at": "Fecha de la respuesta",
  "submission.score": "Puntaje",
  "submission.nps_category": "Categoría NPS",
  "schedule.date": "Fecha",
  "schedule.weekday": "Día de la semana",
  "schedule.time": "Hora",
  "group.name": "Nombre del grupo",
  "reaction.emoji": "Reacción",
  "poll.question": "Pregunta de la encuesta",
  "poll.selected": "Opción elegida",
};

export interface VariableLabelSources {
  /** Rótulos del esquema del disparador, por ruta REAL (`answer.x`, `booking.answers.x`, `sale.status`…). */
  schemaLabels?: Readonly<Record<string, string>>;
  /** slug → nombre de los campos personalizados del contacto. */
  customFieldNames?: Readonly<Record<string, string>>;
}

/** El grupo de una variable en el selector. */
export function variableGroup(path: string): string {
  if (path.startsWith("contact.custom.")) return CUSTOM_FIELDS_GROUP;
  if (STEP_OUTPUTS.has(path)) return PREVIOUS_STEPS_GROUP;
  if (!path.includes(".")) return PREVIOUS_STEPS_GROUP;
  return ROOT_GROUPS[path.split(".")[0]] ?? PREVIOUS_STEPS_GROUP;
}

/** El nombre en castellano de una variable, o la ruta misma si no hay uno. */
export function variableLabel(path: string, sources: VariableLabelSources = {}): string {
  const schema = sources.schemaLabels ?? {};
  const alias = aliasFor(path);
  const fromSchema = schema[path] || (alias ? schema[alias] : undefined);
  if (fromSchema) return fromSchema;
  if (path.startsWith("contact.custom.")) {
    const slug = path.slice("contact.custom.".length);
    return sources.customFieldNames?.[slug] || slug;
  }
  return KNOWN_LABELS[path] ?? path;
}

export interface VariableGroupView {
  group: string;
  items: Array<{ path: string; label: string }>;
}

/** Las variables agrupadas, en el orden en que aparecen (el selector ya las ordena: disparador, pasos, contacto…). */
export function groupVariables(paths: readonly string[], sources: VariableLabelSources = {}): VariableGroupView[] {
  const groups = new Map<string, VariableGroupView>();
  for (const path of paths) {
    const group = variableGroup(path);
    if (!groups.has(group)) groups.set(group, { group, items: [] });
    groups.get(group)!.items.push({ path, label: variableLabel(path, sources) });
  }
  return [...groups.values()];
}

/** Filtra por lo que escribe la persona: busca en el nombre, la ruta y el grupo, sin tildes ni mayúsculas. */
export function filterVariableGroups(groups: readonly VariableGroupView[], query: string): VariableGroupView[] {
  const q = normalize(query);
  if (!q) return [...groups];
  return groups
    .map((g) => {
      const groupHit = normalize(g.group).includes(q);
      return { group: g.group, items: groupHit ? g.items : g.items.filter((i) => normalize(i.label).includes(q) || normalize(i.path).includes(q)) };
    })
    .filter((g) => g.items.length > 0);
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}
