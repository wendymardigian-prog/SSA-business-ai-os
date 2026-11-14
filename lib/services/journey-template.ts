// @plantilla-quitar(servicios)
/**
 * La plantilla del camino de una variante (`product_variants.journey_template`, F13, F24).
 *
 * Modulo puro, gemelo de `app_servicio.validate_journey_template` (00332): los casos de
 * `journey-template.cases.json` corren contra las dos. Lo que depende de la base (que un formulario sea
 * del mismo negocio o programa, que un tipo de reunion exista, que una plantilla de certificado sea de
 * tipo certificado) se valida con el `context` cuando viene, y siempre en SQL.
 *
 * Claves estables: `ph_xxxxxx` para fases e `it_xxxxxx` para pasos. No cambian al renombrar ni al
 * reordenar: los servicios guardan de que paso de la plantilla salio cada uno (`template_key`).
 */
import { AVAILABLE_SECTIONS, ITEM_KINDS, type ItemKind } from "./availability";
import { unknownKeyProblems } from "./json-order";

export const PHASE_KEY = /^ph_[a-z0-9]{6}$/;
export const ITEM_KEY = /^it_[a-z0-9]{6}$/;
export const DUE_FROM = ["service_created", "service_start", "phase_start", "item_completed"] as const;
export const ADVANCE = ["auto", "auto_all", "manual"] as const;
export const CHALLENGE_START = ["previous_phase", "student", "automation", "fixed_date"] as const;
export const FUTURE_VISIBILITY = ["names", "names_and_descriptions", "hidden"] as const;
export const RECUR_EVERY = ["day", "week", "n_days"] as const;
export const RECUR_UNTIL = ["phase_end", "service_end", "n_days", "n_times", "item_completed"] as const;
/** F127.2: desde cuándo se repite (sin `from`, desde el inicio de su fase). */
export const RECUR_FROM = ["service_created", "service_start", "phase_start", "phase_end", "item_completed"] as const;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

export interface DueRule {
  from: (typeof DUE_FROM)[number];
  item_key?: string | null;
  days: number;
}
export interface ItemLight {
  yellow_after_days?: number | null;
  red_after_days?: number | null;
}
export interface JourneyItem {
  key: string;
  kind: ItemKind;
  name: string;
  description?: string;
  required?: boolean;
  assignee?: "student" | "owner" | "user";
  assignee_user_id?: string | null;
  visible_to_client?: boolean;
  portal_button?: boolean;
  ref?: Record<string, unknown>;
  due_rule?: DueRule | null;
  light?: ItemLight | null;
  recurrence?: Record<string, unknown> | null;
  late?: Record<string, unknown> | null;
  reminders?: unknown[] | null;
}
export interface JourneyPhase {
  key: string;
  name: string;
  duration_days?: number | null;
  yellow_day?: number | null;
  red_day?: number | null;
  advance?: (typeof ADVANCE)[number];
  challenge?: Record<string, unknown> | null;
  late_light?: Record<string, unknown> | null;
  items: JourneyItem[];
}
export interface JourneyTemplate {
  v: 1;
  future_visibility?: (typeof FUTURE_VISIBILITY)[number];
  phases: JourneyPhase[];
}

export const EMPTY_TEMPLATE: JourneyTemplate = { v: 1, phases: [] };

/** Lo que la validacion necesita de la base (opcional en TS; siempre en SQL). */
export interface JourneyContext {
  productId?: string;
  /** Formularios del negocio: tipo, programa y si la actividad tiene calificacion. */
  forms?: Record<string, { type: string; productId: string | null; grading?: boolean }>;
  eventTypes?: string[];
  certificateTemplates?: string[];
  /** Modulos y clases del programa. */
  programItems?: string[];
}

const PHASE_KEYS = ["key", "name", "duration_days", "yellow_day", "red_day", "advance", "challenge", "late_light", "items"];
const ITEM_KEYS = [
  "key", "kind", "name", "description", "required", "assignee", "assignee_user_id", "visible_to_client", "portal_button",
  "ref", "due_rule", "light", "recurrence", "late", "reminders",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const nonNegIntOrNull = (v: unknown) => v === null || v === undefined || (isInt(v) && v >= 0);
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** `complete_on` que acepta cada tipo (decision 450). El primero es el de por defecto. */
export const COMPLETE_ON: Partial<Record<ItemKind, readonly string[]>> = {
  form: ["submitted", "reviewed"],
  survey: ["submitted", "reviewed"],
  contract: ["submitted"],
  activity: ["submitted", "reviewed", "passed"],
  quiz: ["passed", "finished"],
  // Servicios A4 (F138): «cuando hay grabación».
  booking: ["booked", "attended", "recorded"],
};

function refProblems(item: JourneyItem, ctx: JourneyContext, nm: string): string[] {
  const p: string[] = [];
  const ref = isObj(item.ref) ? item.ref : {};
  const formKinds: ItemKind[] = ["form", "survey", "contract", "activity", "quiz"];
  if (formKinds.includes(item.kind)) {
    if (!(typeof ref.form_id === "string" && UUID.test(ref.form_id))) {
      p.push(`«${nm}»: elegí el formulario`);
    } else {
      const co = ref.complete_on;
      const allowed = COMPLETE_ON[item.kind] ?? [];
      if (co !== undefined && !allowed.includes(co as string)) p.push(`«${nm}»: elegí cuándo se completa`);
      const f = ctx.forms?.[ref.form_id];
      if (ctx.forms && !f) p.push(`«${nm}»: el formulario no existe`);
      if (f) {
        const want = item.kind === "form" ? "custom" : item.kind;
        if (f.type !== want && !(item.kind === "form" && f.type === "custom")) p.push(`«${nm}»: el formulario no es del tipo del paso`);
        if ((item.kind === "quiz" || item.kind === "activity") && ctx.productId && f.productId !== ctx.productId) {
          p.push(item.kind === "quiz" ? "la evaluación tiene que ser de este programa" : "la actividad tiene que ser de este programa");
        }
        if (item.kind === "activity" && co === "passed" && !f.grading) p.push(`«${nm}»: «al aprobar» necesita una actividad con calificación`);
      }
    }
  } else if (item.kind === "booking") {
    if (!(typeof ref.event_type_id === "string" && UUID.test(ref.event_type_id))) p.push(`«${nm}»: elegí el tipo de reunión`);
    else if (ctx.eventTypes && !ctx.eventTypes.includes(ref.event_type_id)) p.push(`«${nm}»: el tipo de reunión no existe`);
    if (ref.complete_on !== undefined && !(COMPLETE_ON.booking ?? []).includes(ref.complete_on as string)) p.push(`«${nm}»: elegí cuándo se completa`);
  } else if (item.kind === "program_item" || item.kind === "open_module") {
    if (!(typeof ref.program_item_id === "string" && UUID.test(ref.program_item_id))) p.push(`«${nm}»: elegí el módulo o la clase`);
    else if (ctx.programItems && !ctx.programItems.includes(ref.program_item_id)) p.push(`«${nm}»: el módulo o la clase no es de este programa`);
  } else if (item.kind === "certificate") {
    if (has(ref, "templates")) {
      // F127.7: [{if: "on_time", item_key, template_id}, …, {else: true, template_id}].
      const list = ref.templates;
      const ok =
        Array.isArray(list) && list.length >= 2 && list.length <= 5 &&
        list.every((c, i) =>
          isObj(c) && typeof c.template_id === "string" && UUID.test(c.template_id) &&
          (i === list.length - 1
            ? c.else === true && Object.keys(c).length === 2
            : c.if === "on_time" && typeof c.item_key === "string" && ITEM_KEY.test(c.item_key) && Object.keys(c).length === 3));
      if (!ok) p.push(`«${nm}»: las plantillas del certificado no son válidas`);
      else if (ctx.certificateTemplates && (list as Array<{ template_id: string }>).some((c) => !ctx.certificateTemplates!.includes(c.template_id))) p.push(`«${nm}»: la plantilla no es de un certificado de este negocio`);
    } else if (!(typeof ref.template_id === "string" && UUID.test(ref.template_id))) p.push("Elegí la plantilla del certificado");
    else if (ctx.certificateTemplates && !ctx.certificateTemplates.includes(ref.template_id)) p.push(`«${nm}»: la plantilla no es de un certificado de este negocio`);
  } else if (item.kind === "open_section") {
    if (!(AVAILABLE_SECTIONS as readonly string[]).includes(ref.section as string)) p.push(`«${nm}»: elegí la sección`);
  }
  p.push(...buttonProblems(item, ref, nm));
  p.push(...a4RefProblems(item, ref, nm));
  return p;
}

// ── Servicios A4: bloqueo, evidencia, checklist y «cuando hay grabación» (F138, F146 a F148) ──────────────
/** Los pasos que pueden pedir evidencia (un formulario ya es la evidencia). */
export const EVIDENCE_KINDS: readonly ItemKind[] = ["team_task", "student_task", "checkbox"];
export const EVIDENCE_TYPES = ["file", "link", "note"] as const;
/** Los pasos que llevan checklist (viaja a su tarea). */
export const CHECKLIST_KINDS: readonly ItemKind[] = ["team_task", "student_task"];
export const CHECKLIST_MAX_ITEMS = 20;
export const CHECKLIST_ITEM_MAX = 200;
export const LOCK_FROM_VALUES = ["service_created", "service_start", "phase_start"] as const;

/**
 * `ref.lock`, `ref.evidence`, `ref.checklist` y `complete_on = 'recorded'`. Gemela del final de
 * `app_servicio.journey_item_ref_problems` (00369): mismos textos, mismo orden. Que el paso del que espera sea
 * ANTERIOR lo mira `validateJourneyTemplate` (necesita el orden).
 */
function a4RefProblems(item: JourneyItem, ref: Record<string, unknown>, nm: string): string[] {
  const p: string[] = [];
  if (ref.complete_on === "recorded" && item.kind !== "booking") p.push(`«${nm}»: «cuando hay grabación» es solo para pasos Reunión`);
  if (has(ref, "lock")) {
    const l = ref.lock;
    const isAfter = isObj(l) && typeof l.after_item_key === "string" && ITEM_KEY.test(l.after_item_key) && Object.keys(l).length === 1;
    const isFrom = isObj(l) && (LOCK_FROM_VALUES as readonly string[]).includes(l.from as string) && isInt(l.days) && (l.days as number) >= 0 && (l.days as number) <= 365 && Object.keys(l).length === 2;
    if (!isAfter && !isFrom) p.push(`«${nm}»: el bloqueo no es válido`);
  }
  if (has(ref, "evidence")) {
    const e = ref.evidence;
    if (!EVIDENCE_KINDS.includes(item.kind)) p.push(`«${nm}»: la evidencia es solo para tareas y casillas`);
    else if (
      !isObj(e) ||
      e.required !== true ||
      !Array.isArray(e.kinds) ||
      e.kinds.length === 0 ||
      e.kinds.some((k) => !(EVIDENCE_TYPES as readonly string[]).includes(k as string)) ||
      new Set(e.kinds).size !== e.kinds.length
    ) {
      p.push(`«${nm}»: elegí qué evidencia pide`);
    }
  }
  if (has(ref, "checklist")) {
    const c = ref.checklist;
    if (!CHECKLIST_KINDS.includes(item.kind)) p.push(`«${nm}»: el checklist es solo para tareas`);
    else if (!Array.isArray(c) || c.length > CHECKLIST_MAX_ITEMS || c.some((x) => typeof x !== "string" || !x.trim() || chars(x) > CHECKLIST_ITEM_MAX)) {
      p.push(`«${nm}»: el checklist tiene hasta 20 puntos de hasta 200 caracteres`);
    }
  }
  return p;
}

// ── El boton del paso en el portal (F125, decisiones 466 y 467) ────────────
/** Los pasos que no tienen destino automatico: su boton lleva a un link pegado. */
export const LINK_BUTTON_KINDS: readonly ItemKind[] = ["team_task", "student_task", "checkbox"];
/** Los pasos con formulario: el cliente puede ver su respuesta (o el contrato firmado). */
export const SHOW_RESPONSE_KINDS: readonly ItemKind[] = ["form", "survey", "activity", "quiz", "contract"];
export const BUTTON_LABEL_MAX = 40;
export const BUTTON_URL_MAX = 2000;

/** Cuenta caracteres como la base (`char_length`), no unidades UTF-16: un emoji vale uno. */
const chars = (s: string) => Array.from(s).length;

/**
 * `ref.button = { label?, url? }` y `ref.show_response` (ausente = true). Gemela del final de
 * `app_servicio.journey_item_ref_problems` (00363): mismos textos, mismo orden.
 */
function buttonProblems(item: JourneyItem, ref: Record<string, unknown>, nm: string): string[] {
  const p: string[] = [];
  const linkKind = LINK_BUTTON_KINDS.includes(item.kind);
  let url: string | null = null;
  if (has(ref, "button")) {
    const b = ref.button;
    if (!isObj(b)) p.push(`«${nm}»: el botón no es válido`);
    else {
      const label = b.label;
      if (label !== undefined && label !== null && label !== "") {
        if (typeof label !== "string" || chars(label) > BUTTON_LABEL_MAX || /[\r\n]/.test(label)) p.push(`«${nm}»: el texto del botón tiene hasta 40 caracteres, en una línea`);
      }
      const u = b.url;
      if (u !== undefined && u !== null && u !== "") {
        if (!linkKind) p.push(`«${nm}»: este paso ya lleva a su destino`);
        else if (typeof u !== "string" || !/^https:\/\/\S+$/.test(u) || chars(u) > BUTTON_URL_MAX) p.push(`«${nm}»: el link del botón tiene que empezar con https:// y no llevar espacios`);
        else url = u;
      }
    }
  }
  if (item.portal_button === true) {
    if (item.visible_to_client === false) p.push(`«${nm}»: para mostrar el botón, el cliente tiene que ver el paso`);
    else if (linkKind && url === null && !p.some((x) => x.includes("link del botón"))) p.push(`«${nm}»: pegá el link del botón`);
  }
  if (has(ref, "show_response")) {
    if (typeof ref.show_response !== "boolean") p.push(`«${nm}»: «El cliente puede ver su respuesta» no es válido`);
    else if (!SHOW_RESPONSE_KINDS.includes(item.kind)) p.push(`«${nm}»: «El cliente puede ver su respuesta» es solo para pasos con formulario`);
  }
  return p;
}

/** El texto por defecto del boton de un paso (el placeholder del editor; el portal lo usa si no hay uno propio). */
export function defaultButtonLabel(kind: ItemKind | string, _completeOn?: string | null): string {
  switch (kind) {
    case "form":
      return "Completar el formulario";
    case "survey":
      return "Responder la encuesta";
    case "contract":
      return "Firmar el contrato";
    case "activity":
      return "Entregar la actividad";
    case "quiz":
      return "Hacer la evaluación";
    case "booking":
      // Con «cuando asistió», mientras no agendó dice lo mismo; agendada, el portal muestra «Entrar a la llamada».
      return "Agendar la llamada";
    case "program_item":
      return "Ver la clase";
    case "open_module":
      return "Ver el módulo";
    case "certificate":
      return "Ver mi certificado";
    case "open_section":
      return "Ir a la sección";
    default:
      return "Abrir";
  }
}

/** A dónde lleva el botón, en una línea, para el editor (lo arma el portal). */
export function buttonDestination(kind: ItemKind | string, completeOn?: string | null): string {
  switch (kind) {
    case "form":
    case "survey":
    case "contract":
    case "activity":
    case "quiz":
      return "Lleva al formulario con su link firmado: al enviarlo, el paso se completa solo.";
    case "booking":
      return completeOn === "attended"
        ? "Lleva a la agenda de ese tipo de reunión; con una reunión agendada, a la reunión («Entrar a la llamada»)."
        : "Lleva a la agenda de ese tipo de reunión, marcada con este paso.";
    case "program_item":
      return "Lleva a la clase en el portal.";
    case "open_module":
      return "Lleva al módulo en el portal.";
    case "certificate":
      return "Lleva al certificado.";
    case "open_section":
      return "Lleva a la sección del portal.";
    default:
      return "Abre el link que pegues, en una pestaña nueva.";
  }
}

function recurrenceProblems(item: JourneyItem, nm: string): string[] {
  const r = item.recurrence;
  if (r === null || r === undefined) return [];
  if (!isObj(r)) return [`«${nm}»: la repetición no es válida`];
  const p: string[] = [];
  if (!(RECUR_EVERY as readonly string[]).includes(r.every as string)) p.push(`«${nm}»: elegí cada cuánto se repite`);
  if (r.every === "n_days" && !(isInt(r.n) && r.n >= 1 && r.n <= 365)) p.push(`«${nm}»: elegí cada cuántos días se repite`);
  if (!(RECUR_UNTIL as readonly string[]).includes(r.until as string)) p.push(`«${nm}»: elegí hasta cuándo se repite`);
  if ((r.until === "n_days" || r.until === "n_times") && !(isInt(r.n_until) && r.n_until >= 1 && r.n_until <= 1000)) p.push(`«${nm}»: elegí cuántas veces o días`);
  // F127.2: anclas nuevas (mismo orden que app_servicio.journey_recurrence_problems, 00376).
  if (r.until === "item_completed" && !(typeof r.item_key === "string" && ITEM_KEY.test(r.item_key))) p.push(`«${nm}»: elegí el paso que corta la repetición`);
  if (has(r, "phase_key") && r.phase_key !== null && !(r.until === "phase_end" && typeof r.phase_key === "string" && PHASE_KEY.test(r.phase_key))) p.push(`«${nm}»: la fase no es válida`);
  if (has(r, "max_days") && r.max_days !== null && !(isInt(r.max_days) && r.max_days >= 1 && r.max_days <= 1000)) p.push(`«${nm}»: el tope de días va de 1 a 1000`);
  if (has(r, "from") && r.from !== null) {
    const f = r.from;
    const ok =
      isObj(f) && (RECUR_FROM as readonly string[]).includes(f.from as string) && isInt(f.days) && f.days >= 0 && f.days <= 3650 &&
      (f.from === "item_completed" ? typeof f.item_key === "string" && ITEM_KEY.test(f.item_key) : !has(f, "item_key") || f.item_key === null) &&
      (!has(f, "phase_key") || f.phase_key === null || ((f.from === "phase_start" || f.from === "phase_end") && typeof f.phase_key === "string" && PHASE_KEY.test(f.phase_key)));
    if (!ok) p.push(`«${nm}»: elegí desde cuándo se repite`);
  }
  return p;
}

/** F127.3: `late = {accept?, early?, grace_hours?, grace_days?, counts?, message?}`. */
function lateProblems(item: JourneyItem, nm: string): string[] {
  const l = item.late;
  if (l === null || l === undefined) return [];
  const intIn = (v: unknown, max: number) => v === undefined || v === null || (isInt(v) && v >= 0 && v <= max);
  const boolOrAbsent = (v: unknown) => v === undefined || typeof v === "boolean";
  if (!isObj(l) || !boolOrAbsent(l.accept) || !boolOrAbsent(l.early) || !intIn(l.grace_hours, 168) || !intIn(l.grace_days, 365)) return [`«${nm}»: el atraso no es válido`];
  return [];
}

/** F127.1, F127.5 y F127.6: las reglas, el control semanal y la fecha límite del Reto. */
function challengeProblems(c: Record<string, unknown>, label: string): string[] {
  const p: string[] = [];
  const a = c.acceptance;
  if (a !== undefined && a !== null) {
    if (!isObj(a)) p.push(`«${label}»: las reglas para aceptar no son válidas`);
    else {
      if (c.start !== "student") p.push(`«${label}»: las reglas para aceptar son solo si lo empieza el estudiante`);
      if (a.enabled === true) {
        const items = a.items;
        if (!(Array.isArray(items) && items.length >= 1 && items.length <= 20 && items.every((x) => typeof x === "string" && x.trim() !== "" && x.length <= 300))) {
          p.push(`«${label}»: las reglas tienen de 1 a 20 puntos de hasta 300 caracteres`);
        }
      }
      if ((a.description !== undefined && a.description !== null && !(typeof a.description === "string" && a.description.length <= 2000)) ||
          (a.button_label !== undefined && a.button_label !== null && !(typeof a.button_label === "string" && a.button_label.length <= 40 && !/[\r\n]/.test(a.button_label)))) {
        p.push(`«${label}»: el texto de las reglas o del botón es muy largo`);
      }
    }
  }
  const w = c.weekly;
  if (w !== undefined && w !== null) {
    const keyOk = (v: unknown) => v === undefined || v === null || (typeof v === "string" && FIELD_KEY.test(v));
    if (!isObj(w) || !(w.min === undefined || w.min === null || (typeof w.min === "number" && w.min >= 0 && w.min <= 1000)) ||
        !(w.video === undefined || typeof w.video === "boolean") || !keyOk(w.number_field_key) || !keyOk(w.link_field_key) || !keyOk(w.stuck_field_key)) {
      p.push(`«${label}»: el control semanal no es válido`);
    }
  }
  const sb = c.start_by;
  if (sb !== undefined && sb !== null) {
    if (!isObj(sb) || !(sb.from === "service_start" || sb.from === "service_created") || !(isInt(sb.days) && sb.days >= 0 && sb.days <= 3650)) {
      p.push(`«${label}»: la fecha límite para empezar no es válida`);
    }
  }
  return p;
}

/** F127: las fases y pasos que nombran la repetición y el certificado existen (y no son los suyos). */
function crossRefProblems(it: JourneyItem, nm: string, ownPhase: string, phases: Set<string>, items: Set<string>): string[] {
  const p: string[] = [];
  const r = isObj(it.recurrence) ? it.recurrence : null;
  const f = r && isObj(r.from) ? r.from : null;
  const pk = [f?.phase_key, r?.phase_key].filter((x): x is string => typeof x === "string" && PHASE_KEY.test(x));
  if (pk.some((k) => !phases.has(k) || k === ownPhase)) p.push(`«${nm}»: la fase de la repetición tiene que ser otra fase del camino`);
  const ik = [f?.item_key, r?.until === "item_completed" ? r?.item_key : undefined].filter((x): x is string => typeof x === "string" && ITEM_KEY.test(x));
  if (ik.some((k) => !items.has(k) || k === it.key)) p.push(`«${nm}»: el paso de la repetición tiene que ser otro paso del camino`);
  const ref = isObj(it.ref) ? it.ref : null;
  if (it.kind === "certificate" && ref && Array.isArray(ref.templates)) {
    const keys = (ref.templates as unknown[]).map((c) => (isObj(c) ? c.item_key : undefined)).filter((x): x is string => typeof x === "string" && ITEM_KEY.test(x));
    if (keys.some((k) => !items.has(k))) p.push(`«${nm}»: el paso del certificado no existe`);
  }
  return p;
}

/** Los problemas de una plantilla. Vacio = esta bien. */
export function validateJourneyTemplate(template: unknown, ctx: JourneyContext = {}): string[] {
  const p: string[] = [];
  if (!isObj(template)) return ["el camino tiene que ser un objeto"];
  p.push(...unknownKeyProblems(template, ["v", "future_visibility", "phases"]));
  if (template.v !== 1) p.push("versión desconocida");
  if (has(template, "future_visibility") && !(FUTURE_VISIBILITY as readonly string[]).includes(template.future_visibility as string)) p.push("elegí qué ve el cliente de las fases que vienen");
  if (!Array.isArray(template.phases)) return [...p, "faltan las fases"];

  const phaseKeys = new Set<string>();
  const itemKeys = new Set<string>();
  const seenBefore = new Set<string>();
  // F127: las repeticiones y el certificado pueden nombrar cualquier fase o paso del camino (no solo los anteriores).
  const allPhaseKeys = new Set<string>();
  const allItemKeys = new Set<string>();
  for (const ph of template.phases as unknown[]) {
    if (!isObj(ph)) continue;
    if (typeof ph.key === "string") allPhaseKeys.add(ph.key);
    if (Array.isArray(ph.items)) for (const it of ph.items as unknown[]) if (isObj(it) && typeof it.key === "string") allItemKeys.add(it.key);
  }

  for (const ph of template.phases as unknown[]) {
    if (!isObj(ph)) {
      p.push("hay una fase que no es válida");
      continue;
    }
    p.push(...unknownKeyProblems(ph, PHASE_KEYS));
    const key = ph.key as string;
    if (typeof key !== "string" || !PHASE_KEY.test(key)) p.push("hay una fase con una clave inválida");
    else if (phaseKeys.has(key)) p.push(`la clave ${key} está repetida`);
    else phaseKeys.add(key);
    const name = typeof ph.name === "string" ? ph.name.trim() : "";
    if (!name) p.push("hay una fase sin nombre");
    const label = name || "la fase";
    if (!nonNegIntOrNull(ph.duration_days) || ph.duration_days === 0) p.push(`«${label}»: la duración tiene que ser mayor a cero`);
    if (!nonNegIntOrNull(ph.yellow_day) || !nonNegIntOrNull(ph.red_day)) p.push(`«${label}»: los días de amarillo y rojo tienen que ser enteros`);
    else {
      const y = ph.yellow_day as number | null | undefined;
      const r = ph.red_day as number | null | undefined;
      const d = ph.duration_days as number | null | undefined;
      if (isInt(y) && isInt(r) && y >= r) p.push(`«${label}»: el amarillo tiene que ser antes que el rojo`);
      if (isInt(r) && isInt(d) && r > d) p.push(`«${label}»: el rojo no puede pasar la duración de la fase`);
    }
    if (has(ph, "advance") && !(ADVANCE as readonly string[]).includes(ph.advance as string)) p.push(`«${label}»: elegí cómo avanza`);
    if (ph.challenge !== null && ph.challenge !== undefined) {
      const c = ph.challenge;
      if (!isObj(c)) p.push(`«${label}»: el Reto no es válido`);
      else if (c.enabled === true) {
        if (!(CHALLENGE_START as readonly string[]).includes(c.start as string)) p.push(`«${label}»: elegí cómo empieza el Reto`);
        if (c.start === "fixed_date" && !(typeof c.fixed_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.fixed_date))) p.push(`«${label}»: elegí la fecha del Reto`);
        p.push(...challengeProblems(c, label));
      }
    }
    if (ph.late_light !== null && ph.late_light !== undefined) {
      const l = ph.late_light;
      if (!isObj(l)) p.push(`«${label}»: el semáforo por entregas no es válido`);
      else if (l.enabled === true) {
        if (!(isInt(l.yellow_at) && l.yellow_at >= 1 && isInt(l.red_at) && l.red_at >= l.yellow_at)) p.push(`«${label}»: el rojo por entregas tiene que ser igual o mayor que el amarillo`);
      }
    }
    if (!Array.isArray(ph.items)) {
      p.push(`«${label}»: faltan los pasos`);
      continue;
    }
    for (const raw of ph.items as unknown[]) {
      if (!isObj(raw)) {
        p.push(`«${label}»: hay un paso que no es válido`);
        continue;
      }
      const it = raw as unknown as JourneyItem;
      const nm = typeof it.name === "string" ? it.name : "el paso";
      p.push(...unknownKeyProblems(raw, ITEM_KEYS));
      if (typeof it.key !== "string" || !ITEM_KEY.test(it.key)) p.push("hay un paso con una clave inválida");
      else if (itemKeys.has(it.key)) p.push(`la clave ${it.key} está repetida`);
      else itemKeys.add(it.key);
      if (!(ITEM_KINDS as readonly string[]).includes(it.kind)) {
        p.push(`«${nm}»: tipo de paso desconocido`);
        continue;
      }
      if (!(typeof it.name === "string" && it.name.trim())) p.push("hay un paso sin nombre");
      if (has(raw, "assignee") && !["student", "owner", "user"].includes(it.assignee as string)) p.push(`«${nm}»: elegí a cargo de quién está`);
      if (it.assignee === "user" && !(typeof it.assignee_user_id === "string" && UUID.test(it.assignee_user_id))) p.push(`«${nm}»: elegí la persona a cargo`);
      p.push(...refProblems(it, ctx, nm));
      // F146: «cuando se complete otro paso» solo puede esperar a uno ANTERIOR (sin ciclos).
      const lk = isObj(it.ref) ? (it.ref as Record<string, unknown>).lock : undefined;
      if (isObj(lk) && typeof lk.after_item_key === "string" && ITEM_KEY.test(lk.after_item_key) && !seenBefore.has(lk.after_item_key)) {
        p.push(`«${nm}»: un paso solo puede esperar a uno anterior`);
      }

      const due = it.due_rule;
      if (due !== null && due !== undefined) {
        if (!isObj(due) || !(DUE_FROM as readonly string[]).includes(due.from as string) || !(isInt(due.days) && due.days >= 0 && due.days <= 3650)) {
          p.push(`«${nm}»: el plazo no es válido`);
        } else if (due.from === "item_completed") {
          if (typeof due.item_key !== "string" || !seenBefore.has(due.item_key)) p.push("un paso solo puede depender de uno anterior");
        }
      }
      p.push(...recurrenceProblems(it, nm));
      p.push(...lateProblems(it, nm));
      p.push(...crossRefProblems(it, nm, key, allPhaseKeys, allItemKeys));
      const light = it.light;
      if (light !== null && light !== undefined) {
        if (!isObj(light) || !nonNegIntOrNull(light.yellow_after_days) || !nonNegIntOrNull(light.red_after_days)) {
          p.push(`«${nm}»: el semáforo del paso tiene que ser un número de días`);
        } else {
          const hasRule = (due !== null && due !== undefined) || (it.recurrence !== null && it.recurrence !== undefined);
          if (!hasRule) p.push(`«${nm}»: el semáforo del paso necesita un plazo o que se repita`);
          const y = light.yellow_after_days;
          const r = light.red_after_days;
          if (isInt(y) && isInt(r) && r < y) p.push(`«${nm}»: el rojo tiene que ser igual o mayor que el amarillo`);
        }
      }
      if (typeof it.key === "string") seenBefore.add(it.key);
    }
  }
  return p;
}

/** Una clave nueva y estable para una fase o un paso. */
export function newJourneyKey(prefix: "ph" | "it", random: () => number = Math.random): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(random() * chars.length)];
  return `${prefix}_${s}`;
}

/** Resumen para la lista de variantes: «4 fases · 17 pasos · 84 días». */
export function journeySummary(template: JourneyTemplate | null | undefined): { phases: number; items: number; days: number | null } {
  const phases = template?.phases ?? [];
  const items = phases.reduce((n, ph) => n + (ph.items?.length ?? 0), 0);
  const durations = phases.map((ph) => ph.duration_days);
  const days = durations.length > 0 && durations.every((d) => isInt(d)) ? durations.reduce<number>((a, b) => a + (b as number), 0) : null;
  return { phases: phases.length, items, days };
}
