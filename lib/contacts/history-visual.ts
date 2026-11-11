import type { HistoryItem } from "./history";

/**
 * Como se ve cada entrada del historial del contacto: una categoria (icono) y un tono (color suave).
 *
 * Es puro y no sabe de React: devuelve CLAVES, y el componente (`history-section.tsx`) las traduce a un
 * icono de lucide y a clases de Tailwind. El `audit_log` no trae una categoria, asi que sale del prefijo
 * de la accion (`booking.created`, `sale.paid`, `task.completed`...). Una accion que no se reconoce cae
 * en "other" (icono neutro): nunca rompe ni queda sin icono.
 */

export type HistoryCategory =
  | "email"
  | "flow"
  | "sequence"
  | "booking"
  | "sale"
  | "call"
  | "form"
  | "task"
  | "tag"
  | "status"
  | "qualification"
  | "assign"
  | "agent"
  | "contact"
  | "flag"
  | "import"
  | "design"
  | "other";

export type HistoryTone = "sky" | "orange" | "green" | "violet" | "emerald" | "cyan" | "amber" | "pink" | "slate";

export interface HistoryVisual {
  category: HistoryCategory;
  tone: HistoryTone;
}

/** El tono de cada categoria: uno solo, para que el mismo tipo de cosa se vea siempre igual. */
export const CATEGORY_TONE: Record<HistoryCategory, HistoryTone> = {
  email: "sky",
  flow: "orange",
  sequence: "green",
  booking: "violet",
  sale: "emerald",
  call: "cyan",
  form: "pink",
  task: "slate",
  tag: "slate",
  status: "amber",
  qualification: "amber",
  assign: "sky",
  agent: "violet",
  contact: "slate",
  flag: "amber",
  import: "slate",
  design: "pink",
  other: "slate",
};

const PREFIXES: Array<[prefix: string, category: HistoryCategory]> = [
  ["booking.", "booking"],
  ["event_type.", "booking"],
  ["schedule.", "booking"],
  ["scheduling_profile.", "booking"],
  ["google_calendar.", "booking"],
  ["out_of_office.", "booking"],
  ["category.", "booking"],
  ["sale.", "sale"],
  ["payment", "sale"],
  ["commission", "sale"],
  ["attribution.", "sale"],
  ["expense.", "sale"],
  ["recurring.", "sale"],
  ["product.", "sale"],
  ["variant.", "sale"],
  ["vendor.", "sale"],
  ["finance.", "sale"],
  ["call.", "call"],
  ["form.", "form"],
  ["submission.", "form"],
  ["contact.", "contact"],
  ["assignment_rule.", "assign"],
  ["contract.", "form"],
  ["task.", "task"],
  ["design.", "design"],
  ["design_template.", "design"],
  ["email_", "email"],
  ["qualification", "qualification"],
  ["webhook_endpoint.", "flow"],
  ["automation_", "flow"],
  ["tag", "tag"],
  ["agent_", "agent"],
];

const EXACT: Record<string, HistoryCategory> = {
  setter_status: "status",
  closer_status: "status",
  "contact_statuses.updated": "status",
  assign: "assign",
  enroll: "sequence",
  collision_detected: "sequence",
  collision_resolved: "sequence",
  sequence_paused: "sequence",
  sequence_resumed: "sequence",
  human_takeover: "agent",
  needs_human: "agent",
  needs_human_resolved: "agent",
  whatsapp_handoff: "agent",
  prompt_version: "agent",
  model_changed: "agent",
  summary: "agent",
  revert: "agent",
  do_not_contact: "flag",
  known: "flag",
  customer: "flag",
  temperature: "flag",
  followup: "task",
  import: "import",
  link: "contact",
  create: "contact",
  update: "contact",
  delete: "contact",
  restore: "contact",
};

export function auditCategory(action: string): HistoryCategory {
  if (action in EXACT) return EXACT[action];
  for (const [prefix, category] of PREFIXES) {
    if (action.startsWith(prefix)) return category;
  }
  return "other";
}

export function historyVisual(item: HistoryItem): HistoryVisual {
  let category: HistoryCategory;
  switch (item.source) {
    case "audit":
      category = auditCategory(item.action);
      break;
    case "flow":
      category = "flow";
      break;
    case "sequence":
      category = "sequence";
      break;
    case "email":
      category = "email";
      break;
    case "status":
      category = "status";
      break;
    case "qualification":
      category = "qualification";
      break;
    default:
      category = "other";
  }
  return { category, tone: CATEGORY_TONE[category] };
}

export type DeliveryTone = "good" | "bad" | "warn" | "neutral";

/** El color de cada marca de entrega de un email («Entregado», «Rebotó»...). Una marca nueva queda neutra. */
export function deliveryTone(label: string): DeliveryTone {
  const text = label.toLowerCase();
  if (/rebot|spam|fall/.test(text)) return "bad";
  if (/baja/.test(text)) return "warn";
  if (/entreg|abri|clic/.test(text)) return "good";
  return "neutral";
}
