/**
 * El catalogo de disparadores que ve una persona (auditoria de automatizaciones, oct 2026). Puro: lo usan el
 * selector de disparador, el panel, el nodo del lienzo y la lista de automatizaciones (el registro del motor no se
 * puede importar en el navegador).
 *
 * Es UNA lista: antes estaban el array del panel, las etiquetas en ingles del nodo (que cubrian 7 de 34 tipos y
 * mostraban el id crudo del resto) y el "Keyword Trigger" de la paleta. `registry/consistency.test.ts` exige que
 * diga exactamente lo mismo que el registro y que el CHECK de `triggers.type` en la base.
 */

import type { TriggerType } from "@/lib/types/database";
import { presetFor, SALES_PRESETS } from "@/lib/sales/automation/presets"; // @plantilla-quitar(ventas)
import { triggerConfigDefaults } from "./trigger-defaults";

export type TriggerGroupKey =
  | "mensajes"
  | "comentarios"
  | "contactos"
  | "agenda"
  | "formularios" // @plantilla-quitar(formularios)
  | "ventas" // @plantilla-quitar(ventas)
  | "tareas" // @plantilla-quitar(tareas)
  | "llamadas" // @plantilla-quitar(llamadas)
  | "webhooks" // @plantilla-quitar(webhooks)
  | "equipo"; // @plantilla-quitar(formularios)

export const TRIGGER_GROUPS: ReadonlyArray<{ key: TriggerGroupKey; label: string }> = [
  { key: "mensajes", label: "Mensajes" },
  { key: "comentarios", label: "Comentarios" },
  { key: "contactos", label: "Contactos y CRM" },
  { key: "agenda", label: "Agenda" },
  { key: "formularios", label: "Formularios" }, // @plantilla-quitar(formularios)
  { key: "ventas", label: "Ventas y pagos" }, // @plantilla-quitar(ventas)
  { key: "tareas", label: "Tareas" }, // @plantilla-quitar(tareas)
  { key: "llamadas", label: "Llamadas" }, // @plantilla-quitar(llamadas)
  { key: "webhooks", label: "Webhooks" }, // @plantilla-quitar(webhooks)
  { key: "equipo", label: "Equipo" }, // @plantilla-quitar(formularios)
];

export interface TriggerCatalogEntry {
  type: TriggerType;
  label: string;
  description: string;
  group: TriggerGroupKey;
  /** Otras palabras con las que alguien lo buscaria. */
  synonyms?: string[];
}

export const TRIGGER_CATALOG: readonly TriggerCatalogEntry[] = [
  { type: "keyword", label: "Palabra clave", description: "Cuando el lead escribe una palabra o frase que coincide", group: "mensajes", synonyms: ["keyword", "dm", "mensaje", "chat", "whatsapp", "instagram"] },
  { type: "welcome", label: "Primer mensaje", description: "La primera vez que el lead escribe", group: "mensajes", synonyms: ["bienvenida", "nuevo"] },
  { type: "default", label: "Respuesta por defecto", description: "Cuando ningún otro disparador de mensaje coincide", group: "mensajes", synonyms: ["fallback", "ninguno"] },
  { type: "postback", label: "Clic en un botón", description: "Cuando el lead toca un botón de un mensaje (Instagram)", group: "mensajes", synonyms: ["boton", "postback"] },
  { type: "quick_reply", label: "Respuesta rápida", description: "Cuando el lead toca una respuesta rápida (Instagram)", group: "mensajes", synonyms: ["opcion"] },
  { type: "inactivity", label: "Inactividad", description: "Cuando pasan X horas o días sin que el lead conteste", group: "mensajes", synonyms: ["sin respuesta", "seguimiento"] },
  { type: "email_received", label: "Email recibido", description: "Cuando entra un correo a la dirección del negocio", group: "mensajes", synonyms: ["correo", "mail"] },
  { type: "comment_keyword", label: "Palabra clave en un comentario", description: "Cuando alguien comenta una publicación con una palabra clave", group: "comentarios", synonyms: ["comentario", "post", "publicacion"] },
  { type: "new_contact", label: "Contacto nuevo", description: "Cuando se crea un contacto, venga de donde venga (mensaje, importación o alta manual)", group: "contactos", synonyms: ["lead nuevo", "alta"] },
  { type: "crm_event", label: "Evento del CRM", description: "Cuando cambia algo del contacto: una etiqueta, un campo, el estado, el setter o el vendedor", group: "contactos", synonyms: ["tag", "etiqueta", "campo", "estado", "setter", "vendedor"] },
  { type: "booking_created", label: "Se agendó una reunión", description: "Cuando alguien agenda: por el link, a mano, por el embed o por el agente", group: "agenda", synonyms: ["reunion", "cita", "agenda", "llamada"] },
  { type: "booking_rescheduled", label: "Se cambió la fecha de una reunión", description: "Cuando una reunión se mueve a otro horario", group: "agenda", synonyms: ["reagendar"] },
  { type: "booking_cancelled", label: "Se canceló una reunión", description: "Cuando se cancela una reunión", group: "agenda" },
  { type: "booking_updated", label: "Se editó una reunión", description: "Cuando cambia la ubicación o las notas", group: "agenda" },
  { type: "booking_ended", label: "Terminó una reunión", description: "Cuando pasa la hora de fin y la reunión no quedó cancelada", group: "agenda" },
  { type: "booking_status_changed", label: "Cambió el estado de una reunión", description: "Cuando la reunión pasa a otro estado (no se presentó, venta, seguimiento…)", group: "agenda", synonyms: ["no show"] },
  { type: "booking_before_start", label: "Antes de una reunión", description: "Un recordatorio antes de la hora de inicio", group: "agenda", synonyms: ["recordatorio"] },
  { type: "booking_after_end", label: "Después de una reunión", description: "Un seguimiento después de la hora de fin", group: "agenda", synonyms: ["seguimiento"] },
  { type: "booking_after_created", label: "Después de agendar", description: "Un mensaje un rato después de que agendaron", group: "agenda" },
  { type: "form_submitted", label: "Se envió un formulario", description: "Cuando alguien envía un formulario personalizado", group: "formularios", synonyms: ["form"] }, // @plantilla-quitar(formularios)
  { type: "survey_answered", label: "Se respondió una encuesta", description: "Cuando alguien responde una encuesta, con su puntaje", group: "formularios", synonyms: ["nps"] }, // @plantilla-quitar(formularios)
  { type: "contract_signed", label: "Se firmó un contrato", description: "Cuando alguien firma un contrato", group: "formularios", synonyms: ["firma"] }, // @plantilla-quitar(formularios)
  { type: "sale_created", label: "Venta creada", description: "Cuando se carga una venta nueva", group: "ventas" }, // @plantilla-quitar(ventas)
  { type: "sale_status_changed", label: "Cambió el estado de la venta", description: "Cuando una venta pasa a otro estado (cancelada, pagada, con mora…)", group: "ventas" }, // @plantilla-quitar(ventas)
  { type: "payment_created", label: "Pago creado", description: "Cuando se crea un pago: programado, cobrado o un reembolso", group: "ventas" }, // @plantilla-quitar(ventas)
  { type: "payment_status_changed", label: "Cambió el estado del pago", description: "Cuando un pago pasa a cobrado, moroso, incobrable…", group: "ventas" }, // @plantilla-quitar(ventas)
  { type: "payment_before_due", label: "Antes de un vencimiento", description: "Un recordatorio X días antes de que venza un pago", group: "ventas" }, // @plantilla-quitar(ventas)
  { type: "payment_after_due", label: "Después de un vencimiento impago", description: "Un aviso X días después del vencimiento si el pago sigue sin cobrarse", group: "ventas" }, // @plantilla-quitar(ventas)
  { type: "task_completed", label: "Se completó una tarea", description: "Cuando alguien completa una tarea. Si la tarea no tiene contacto, corre sin contacto", group: "tareas" }, // @plantilla-quitar(tareas)
  { type: "task_overdue", label: "Una tarea quedó vencida", description: "Cuando una tarea vence sin completarse (una vez por vencimiento)", group: "tareas" }, // @plantilla-quitar(tareas)
  { type: "call_analyzed", label: "Se analizó una llamada", description: "Cuando una llamada con contacto queda analizada (nueva o regenerada)", group: "llamadas", synonyms: ["fathom"] }, // @plantilla-quitar(llamadas)
  { type: "call_linked", label: "Se vinculó una llamada", description: "Cuando una llamada se vincula a un contacto, sola o a mano", group: "llamadas", synonyms: ["fathom"] }, // @plantilla-quitar(llamadas)
  { type: "webhook_received", label: "Webhook recibido", description: "Cuando un formulario externo (Typeform, Tally, Framer…) manda datos a tu URL. Arranca sin contacto", group: "webhooks", synonyms: ["api", "zapier", "make", "typeform", "tally"] }, // @plantilla-quitar(webhooks)
  { type: "eod_submitted", label: "Se envió un reporte de fin de día", description: "Cuando alguien del equipo envía su reporte del día. Es sobre la persona, sin contacto", group: "equipo", synonyms: ["eod", "reporte"] }, // @plantilla-quitar(formularios)
];

const BY_TYPE = new Map<string, TriggerCatalogEntry>(TRIGGER_CATALOG.map((e) => [e.type, e]));

export function triggerEntry(type: string | null | undefined): TriggerCatalogEntry | undefined {
  return type ? BY_TYPE.get(type) : undefined;
}

/** Una opcion del selector: un tipo, o un atajo de Ventas (un tipo + la configuracion que deja elegida). */
export interface TriggerChoice {
  key: string;
  type: TriggerType;
  label: string;
  description: string;
  group: TriggerGroupKey;
  synonyms: string[];
  /** Lo que la opcion deja elegido ademas de los valores por defecto del tipo. */
  config: Record<string, unknown>;
}

/** Las opciones del selector, en el orden de los grupos. Ventas se ofrece con sus atajos (`SALES_PRESETS`). */
export function triggerChoices(): TriggerChoice[] {
  const out: TriggerChoice[] = [];
  for (const group of TRIGGER_GROUPS) {
    // @plantilla-desde(ventas)
    if (group.key === "ventas") {
      for (const preset of SALES_PRESETS) {
        out.push({ key: `sales:${preset.key}`, type: preset.type, label: preset.label, description: preset.description, group: "ventas", synonyms: ["venta", "pago", "cobro"], config: preset.config });
      }
      continue;
    }
    // @plantilla-hasta(ventas)
    for (const entry of TRIGGER_CATALOG.filter((e) => e.group === group.key)) {
      out.push({ key: entry.type, type: entry.type, label: entry.label, description: entry.description, group: entry.group, synonyms: entry.synonyms ?? [], config: {} });
    }
  }
  return out;
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** El buscador del selector: por nombre, descripcion, grupo y sinonimos; todas las palabras tienen que estar. */
export function filterTriggerChoices(choices: TriggerChoice[], query: string): TriggerChoice[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return choices;
  return choices.filter((choice) => {
    const group = TRIGGER_GROUPS.find((g) => g.key === choice.group)?.label ?? "";
    const haystack = fold([choice.label, choice.description, group, ...choice.synonyms].join(" "));
    return words.every((w) => haystack.includes(w));
  });
}

/** Las claves del nodo disparador que no son configuracion. */
const NODE_KEYS = new Set(["label", "triggerType"]);

/** Si el disparador ya tiene algo configurado (cambiarlo lo perderia y conviene avisar). */
export function hasTriggerConfig(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  return Object.entries(data).some(([key, value]) => {
    if (NODE_KEYS.has(key) || value === undefined || value === null || value === "" || value === false) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as object).length > 0;
    return true;
  });
}

/**
 * Los datos del nodo al elegir una opcion: el tipo, sus valores por defecto (los que el panel muestra) y lo que deja
 * elegido el atajo. Lo del disparador anterior NO se arrastra (era de otro tipo); el nombre del paso si.
 */
export function applyTriggerChoice(current: Record<string, unknown> | null | undefined, choice: TriggerChoice): Record<string, unknown> {
  const label = typeof current?.label === "string" ? { label: current.label } : {};
  const keywords = choice.type === "keyword" || choice.type === "comment_keyword" ? { keywords: [] } : {};
  const dueDefaults = choice.type === "payment_before_due" || choice.type === "payment_after_due" ? { offset_days: 3, at_time: "09:00" } : {}; // @plantilla-quitar(ventas)
  // @plantilla-sin(ventas): const dueDefaults = {};
  return { ...label, triggerType: choice.type, ...keywords, ...triggerConfigDefaults(choice.type), ...dueDefaults, ...choice.config };
}

/** El tipo elegido: `null` si todavia no se eligio. Un nodo viejo sin la clave se lee como palabra clave. */
export function chosenType(data: Record<string, unknown> | null | undefined): string | null {
  if (!data || !("triggerType" in data) || data.triggerType === undefined) return "keyword";
  return typeof data.triggerType === "string" && data.triggerType.trim() ? data.triggerType : null;
}

/** Como se llama el disparador elegido, para el nodo del lienzo y el panel. */
export function triggerDisplayLabel(data: Record<string, unknown> | null | undefined): string {
  const type = chosenType(data);
  if (!type) return "Elegí cómo arranca";
  const preset = presetFor(type, data); // @plantilla-quitar(ventas)
  if (preset) return preset.label; // @plantilla-quitar(ventas)
  return triggerEntry(type)?.label ?? type;
}

/** La opcion del selector que corresponde a lo guardado (para marcarla): el atajo de Ventas, o el tipo. */
export function choiceKeyFor(data: Record<string, unknown> | null | undefined): string | null {
  const type = chosenType(data);
  if (!type) return null;
  const preset = presetFor(type, data); // @plantilla-quitar(ventas)
  return preset ? `sales:${preset.key}` : type; // @plantilla-quitar(ventas)
  // @plantilla-sin(ventas): return type;
}
