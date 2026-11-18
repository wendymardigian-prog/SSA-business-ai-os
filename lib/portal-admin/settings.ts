// @plantilla-quitar(servicios)
/**
 * La configuracion del portal en columnas (decision 458):
 * - `product_variants.portal_settings`: acceso de la variante y sus secciones (F36, F109, F113, F116).
 * - `products.portal_settings`: lo del programa (secciones prendidas, terminos, comunidad, afiliados,
 *   asistente) (F35, F77, F85, F106, F110, F113).
 * - `workspaces.portal_settings`: Ajustes del portal (F43).
 *
 * Modulo puro, gemelo de `app_servicio.validate_variant_portal_settings`,
 * `validate_program_portal_settings` y `validate_workspace_portal_settings` (00332): los casos de
 * `portal-settings.cases.json` corren contra las dos. Lo que depende de la base (que un modulo sea de
 * este programa, que un paso exista en el camino) se valida aparte.
 */
import { ALL_SECTIONS, AVAILABLE_SECTIONS, EXTENSION_SECTIONS } from "@/lib/services/availability";
import { fameSettingsProblems, projectsSettingsProblems } from "@/lib/projects/settings"; // @plantilla-quitar(proyectos)
import { jsonbKeys, unknownKeyProblems } from "@/lib/services/json-order";

export const OPENS_TYPES = [
  "service_start",
  "days_after_start",
  "fixed_date",
  "phase_completed",
  "item_completed",
  "module_completed",
  "challenge_started",
  "journey_item",
  "automation",
] as const;
export const UNTIL_TYPES = ["service", "days", "months", "fixed_date", "phase_completed", "item_completed", "forever"] as const;
export const DISPLAY_TYPES = ["locked", "coming_soon", "hidden"] as const;

export interface SectionRule {
  section: string;
  included?: boolean;
  display?: (typeof DISPLAY_TYPES)[number];
  content?: { modules: "all" | string[] };
  opens?: { type: (typeof OPENS_TYPES)[number]; ref?: string | null; days?: number | null; date?: string | null };
  until?: { type: (typeof UNTIL_TYPES)[number]; ref?: string | null; n?: number | null; date?: string | null };
  limits?: { community_can_post?: boolean };
  ai_limit_usd?: number | null;
  /** Los módulos que la variante no incluye (00404): no se ven, con candado o con la invitación para pasarse. Solo Programa. */
  not_included?: NotIncluded;
}
export const NOT_INCLUDED_MODES = ["hidden", "locked", "invite"] as const;
export const NOT_INCLUDED_TARGETS = ["link", "form", "event", "whatsapp"] as const;
export interface NotIncluded {
  mode: (typeof NOT_INCLUDED_MODES)[number];
  label?: string;
  text?: string;
  button?: string;
  target?: { kind: (typeof NOT_INCLUDED_TARGETS)[number]; id?: string; url?: string; value?: string; prefill?: string };
  on_click?: { tag_id?: string | null; notify?: "owner" | "admins" | string | null };
}
export interface VariantPortalSettings {
  v?: 1;
  enabled?: boolean;
  ask_terms?: boolean;
  sections?: SectionRule[];
  /** La comunidad del programa a la que pertenece la variante (00402). Sin elegir, la principal. */
  community_key?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const unknownKeys = unknownKeyProblems;

const SECTION_KEYS = ["section", "included", "display", "content", "opens", "until", "limits", "ai_limit_usd", "not_included"];

/** Con la extensión de proyectos prendida en el negocio, `fame` y `projects` se ofrecen (Corrida C). */
export interface PortalValidationOptions {
  extensions?: { projects?: boolean };
}

const offered = (sec: string, o: PortalValidationOptions) =>
  (AVAILABLE_SECTIONS as readonly string[]).includes(sec) || (o.extensions?.projects === true && (EXTENSION_SECTIONS as readonly string[]).includes(sec));

function sectionProblems(rule: Record<string, unknown>, o: PortalValidationOptions = {}): string[] {
  const p: string[] = [];
  const sec = rule.section as string;
  p.push(...unknownKeys(rule, SECTION_KEYS));
  if (!(ALL_SECTIONS as readonly string[]).includes(sec)) return [...p, `sección desconocida: ${String(sec)}`];
  if (!offered(sec, o)) return [...p, "Todavía no está disponible"];
  if (has(rule, "display") && !(DISPLAY_TYPES as readonly string[]).includes(rule.display as string)) p.push(`${sec}: elegí cómo se ve mientras está cerrada`);
  if (has(rule, "content")) {
    const c = rule.content;
    const ok = isObj(c) && (c.modules === "all" || (Array.isArray(c.modules) && c.modules.length > 0 && c.modules.every((m) => typeof m === "string" && UUID.test(m))));
    if (!ok) p.push(`${sec}: elegí el contenido incluido`);
    else if (sec !== "program") p.push(`${sec}: solo el Programa elige contenido`);
  }
  if (has(rule, "opens")) {
    const o = rule.opens;
    if (!isObj(o) || !(OPENS_TYPES as readonly string[]).includes(o.type as string)) p.push(`${sec}: elegí cuándo se abre`);
    else {
      if (o.type === "days_after_start" && !(isInt(o.days) && o.days >= 1 && o.days <= 3650)) p.push(`${sec}: elegí cuántos días después del inicio`);
      if (o.type === "fixed_date" && !(typeof o.date === "string" && DATE.test(o.date))) p.push(`${sec}: elegí la fecha en que se abre`);
      if (["phase_completed", "item_completed", "module_completed"].includes(o.type as string) && !(typeof o.ref === "string" && o.ref.length > 0)) {
        p.push(`${sec}: elegí qué la abre`);
      }
    }
  }
  if (has(rule, "until")) {
    const u = rule.until;
    if (!isObj(u) || !(UNTIL_TYPES as readonly string[]).includes(u.type as string)) p.push(`${sec}: elegí hasta cuándo dura`);
    else {
      if ((u.type === "days" || u.type === "months") && !(isInt(u.n) && u.n >= 1 && u.n <= 3650)) p.push(`${sec}: elegí cuánto dura`);
      if (u.type === "fixed_date" && !(typeof u.date === "string" && DATE.test(u.date))) p.push(`${sec}: elegí la fecha en que termina`);
      if ((u.type === "phase_completed" || u.type === "item_completed") && !(typeof u.ref === "string" && u.ref.length > 0)) p.push(`${sec}: elegí qué la termina`);
    }
  }
  if (has(rule, "limits")) {
    const l = rule.limits;
    if (!isObj(l) || (has(l, "community_can_post") && typeof l.community_can_post !== "boolean")) p.push(`${sec}: los límites no son válidos`);
  }
  if (has(rule, "ai_limit_usd") && rule.ai_limit_usd !== null) {
    const v = rule.ai_limit_usd;
    if (!(typeof v === "number" && v >= 0 && v <= 10000)) p.push(`${sec}: el límite de IA va de 0 a 10.000 dólares`);
    else if (sec !== "assistant") p.push(`${sec}: solo el Asistente IA tiene límite de gasto`);
  }
  if (has(rule, "not_included")) p.push(...notIncludedProblems(rule));
  return p;
}

const chars = (v: string) => [...v].length;
const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";
const textOk = (v: unknown, max: number) => typeof v === "string" && chars(v) <= max;

/**
 * Los módulos que la variante no incluye (00404), gemela de `app_servicio.not_included_problems`. Con `hidden` no se mira
 * el resto (se apaga sin borrar lo escrito).
 */
export function notIncludedProblems(rule: Record<string, unknown>): string[] {
  const sec = String(rule.section);
  const n = rule.not_included;
  if (!isObj(n)) return [`${sec}: los módulos no incluidos no son válidos`];
  const p = unknownKeys(n, ["mode", "label", "text", "button", "target", "on_click"]);
  if (sec !== "program") return [...p, `${sec}: solo el Programa muestra los módulos no incluidos`];
  const m = typeof n.mode === "string" ? n.mode : null;
  if (!m || !(NOT_INCLUDED_MODES as readonly string[]).includes(m)) return [...p, `${sec}: elegí cómo se ven los módulos no incluidos`];
  if (m === "hidden") return p;
  const c = rule.content;
  if (!(isObj(c) && Array.isArray(c.modules))) p.push(`${sec}: con todo el programa incluido no hay módulos para mostrar`);
  if (has(n, "label") && !textOk(n.label, 40)) p.push(`${sec}: la etiqueta va hasta 40 caracteres`);
  else if (m === "invite" && blank(n.label)) p.push(`${sec}: escribí la etiqueta de los módulos no incluidos`);
  if (has(n, "text") && !textOk(n.text, 400)) p.push(`${sec}: el texto de la invitación va hasta 400 caracteres`);
  else if (m === "invite" && blank(n.text)) p.push(`${sec}: escribí el texto de la invitación`);
  if (has(n, "button") && !textOk(n.button, 30)) p.push(`${sec}: el botón va hasta 30 caracteres`);
  else if (m === "invite" && blank(n.button)) p.push(`${sec}: escribí el texto del botón`);
  if (has(n, "target") || m === "invite") {
    const t = n.target;
    if (!isObj(t) || !(NOT_INCLUDED_TARGETS as readonly string[]).includes(t.kind as string)) p.push(`${sec}: elegí a dónde lleva el botón`);
    else {
      p.push(...unknownKeys(t, ["kind", "id", "url", "value", "prefill"]));
      if (t.kind === "link" && !(typeof t.url === "string" && /^https:\/\/\S+$/.test(t.url) && chars(t.url) <= 2000)) p.push(`${sec}: el link tiene que empezar con https://`);
      if ((t.kind === "form" || t.kind === "event") && !(typeof t.id === "string" && UUID.test(t.id) && typeof t.url === "string" && /^https?:\/\/\S+$/.test(t.url) && chars(t.url) <= 2000)) {
        p.push(`${sec}: elegí el formulario o la agenda`);
      }
      if (t.kind === "whatsapp" && !(typeof t.value === "string" && /^[1-9][0-9]{7,14}$/.test(t.value))) p.push(`${sec}: el WhatsApp va con el código de país, solo números`);
      if (has(t, "prefill") && !textOk(t.prefill, 500)) p.push(`${sec}: el mensaje de WhatsApp va hasta 500 caracteres`);
    }
  }
  if (has(n, "on_click")) {
    const oc = n.on_click;
    if (!isObj(oc)) p.push(`${sec}: revisá qué pasa al tocar el botón`);
    else {
      p.push(...unknownKeys(oc, ["tag_id", "notify"]));
      const badTag = has(oc, "tag_id") && oc.tag_id !== null && !(typeof oc.tag_id === "string" && UUID.test(oc.tag_id));
      const badNotify = has(oc, "notify") && oc.notify !== null && !(typeof oc.notify === "string" && (oc.notify === "owner" || oc.notify === "admins" || UUID.test(oc.notify)));
      if (badTag || badNotify) p.push(`${sec}: revisá qué pasa al tocar el botón`);
    }
  }
  return p;
}

/** Problemas de `product_variants.portal_settings`. */
export function validateVariantPortalSettings(settings: unknown, o: PortalValidationOptions = {}): string[] {
  if (!isObj(settings)) return ["la configuración tiene que ser un objeto"];
  const p = unknownKeys(settings, ["v", "enabled", "ask_terms", "sections", "community_key"]);
  if (has(settings, "v") && settings.v !== 1) p.push("versión desconocida");
  if (has(settings, "enabled") && typeof settings.enabled !== "boolean") p.push("«Acceso al portal» tiene que ser sí o no");
  if (has(settings, "ask_terms") && typeof settings.ask_terms !== "boolean") p.push("«Esta variante los pide» tiene que ser sí o no");
  if (has(settings, "community_key") && settings.community_key !== null && !(typeof settings.community_key === "string" && /^[a-z0-9_]{1,40}$/.test(settings.community_key))) {
    p.push("la comunidad no es válida");
  }
  if (has(settings, "sections")) {
    if (!Array.isArray(settings.sections)) p.push("las secciones no son válidas");
    else {
      const seen = new Set<string>();
      for (const s of settings.sections) {
        if (!isObj(s)) {
          p.push("hay una sección que no es válida");
          continue;
        }
        if (typeof s.section === "string") {
          if (seen.has(s.section)) p.push(`la sección ${s.section} está repetida`);
          seen.add(s.section);
        }
        p.push(...sectionProblems(s, o));
      }
    }
  }
  return p;
}

/** Problemas de `products.portal_settings` (lo del programa). */
export function validateProgramPortalSettings(settings: unknown, o: PortalValidationOptions = {}): string[] {
  if (!isObj(settings)) return ["la configuración tiene que ser un objeto"];
  const ext = o.extensions?.projects === true;
  const p = unknownKeys(settings, ["v", "sections", "terms", "community", "affiliates", "assistant", ...(ext ? ["fame", "projects"] : [])]);
  if (has(settings, "v") && settings.v !== 1) p.push("versión desconocida");
  if (has(settings, "sections")) {
    const s = settings.sections;
    if (!isObj(s)) p.push("las secciones no son válidas");
    else
      for (const k of jsonbKeys(s)) {
        const v = s[k];
        if (!(ALL_SECTIONS as readonly string[]).includes(k)) p.push(`sección desconocida: ${k}`);
        else if (!offered(k, o)) p.push("Todavía no está disponible");
        else if (typeof v !== "boolean") p.push(`${k}: tiene que ser sí o no`);
      }
  }
  if (has(settings, "terms")) {
    const t = settings.terms;
    if (!isObj(t)) p.push("los términos no son válidos");
    else {
      p.push(...unknownKeys(t, ["enabled", "form_id", "ask_again_on_change"]));
      if (t.enabled === true && !(typeof t.form_id === "string" && UUID.test(t.form_id))) p.push("cargá los términos antes de prenderlos");
    }
  }
  if (has(settings, "community")) {
    const c = settings.community;
    if (!isObj(c)) p.push("la comunidad no es válida");
    else {
      p.push(...unknownKeys(c, ["lesson_comments", "spaces", "communities"]));
      p.push(...communitiesProblems(c));
      if (has(c, "spaces")) {
        if (!Array.isArray(c.spaces)) p.push("los espacios no son válidos");
        else {
          const keys = new Set<string>();
          for (const sp of c.spaces) {
            if (!isObj(sp) || typeof sp.key !== "string" || !/^[a-z0-9_]{1,40}$/.test(sp.key) || typeof sp.name !== "string" || !sp.name.trim()) {
              p.push("hay un espacio sin nombre o con una clave inválida");
              continue;
            }
            if (keys.has(sp.key)) p.push(`el espacio ${sp.key} está repetido`);
            keys.add(sp.key);
          }
        }
      }
    }
  }
  if (has(settings, "affiliates")) {
    const a = settings.affiliates;
    if (!isObj(a) || (has(a, "visible_link_keys") && !(Array.isArray(a.visible_link_keys) && a.visible_link_keys.every((k) => typeof k === "string" && /^lk_[a-z0-9]{6}$/.test(k))))) {
      p.push("los links de afiliados no son válidos");
    }
  }
  if (has(settings, "assistant")) {
    const a = settings.assistant;
    if (!isObj(a)) p.push("el asistente no es válido");
    else {
      p.push(...unknownKeys(a, ["excluded_kb_ids", "monthly_limit_usd_per_student", "credits_per_usd", "credits_name", "suggestions"]));
      if (has(a, "monthly_limit_usd_per_student") && !(typeof a.monthly_limit_usd_per_student === "number" && a.monthly_limit_usd_per_student >= 0 && a.monthly_limit_usd_per_student <= 10000)) {
        p.push("el límite por estudiante va de 0 a 10.000 dólares");
      }
      if (has(a, "credits_per_usd") && !(isInt(a.credits_per_usd) && a.credits_per_usd >= 1 && a.credits_per_usd <= 100000)) p.push("los créditos por dólar tienen que ser un número entero positivo");
    }
  }
  // @plantilla-desde(proyectos)
  // Corrida C: la Sala de la fama y Mis proyectos (sin la extensión ya cayeron como clave desconocida).
  if (ext && has(settings, "fame")) p.push(...fameSettingsProblems(settings.fame));
  if (ext && has(settings, "projects")) p.push(...projectsSettingsProblems(settings.projects));
  // @plantilla-hasta(proyectos)
  return p;
}

/**
 * Las comunidades del programa (`community.communities`, 00402), gemela de `app_servicio.community_settings_problems`
 * sin la parte de la base (archivar una comunidad que usa una variante se controla allá).
 */
export function communitiesProblems(c: Record<string, unknown>): string[] {
  if (!has(c, "communities")) return [];
  if (!Array.isArray(c.communities)) return ["las comunidades no son válidas"];
  if (c.communities.length === 0) return ["dejá al menos una comunidad"];
  const p: string[] = [];
  const keys = new Set<string>();
  const names = new Set<string>();
  let mains = 0;
  for (const x of c.communities) {
    if (!isObj(x) || typeof x.key !== "string" || !/^[a-z0-9_]{1,40}$/.test(x.key) || typeof x.name !== "string" || !x.name.trim()) {
      p.push("hay una comunidad sin nombre o con una clave inválida");
      continue;
    }
    const name = x.name.trim();
    p.push(...unknownKeys(x, ["key", "name", "main", "archived", "spaces"]));
    if (keys.has(x.key)) p.push(`la comunidad ${x.key} está repetida`);
    keys.add(x.key);
    if (names.has(name.toLowerCase())) p.push(`ya hay una comunidad que se llama ${name}`);
    names.add(name.toLowerCase());
    if ((has(x, "main") && typeof x.main !== "boolean") || (has(x, "archived") && typeof x.archived !== "boolean")) p.push(`${name}: principal y archivada son sí o no`);
    if (x.main === true) {
      mains++;
      if (x.archived === true) p.push("la comunidad principal no se puede archivar");
    }
    if (has(x, "spaces")) {
      if (!Array.isArray(x.spaces)) p.push(`${name}: los espacios no son válidos`);
      else {
        const sk = new Set<string>();
        for (const sp of x.spaces) {
          if (!isObj(sp) || typeof sp.key !== "string" || !/^[a-z0-9_]{1,40}$/.test(sp.key) || typeof sp.name !== "string" || !sp.name.trim()) {
            p.push(`${name}: hay un espacio sin nombre o con una clave inválida`);
            continue;
          }
          if (sk.has(sp.key)) p.push(`${name}: el espacio ${sp.key} está repetido`);
          sk.add(sp.key);
        }
      }
    }
  }
  if (mains !== 1) p.push("elegí una sola comunidad principal");
  return p;
}

/** Problemas de `workspaces.portal_settings` (Ajustes del portal). */
export function validateWorkspacePortalSettings(settings: unknown): string[] {
  if (!isObj(settings)) return ["la configuración tiene que ser un objeto"];
  const p = unknownKeys(settings, ["v", "host", "from_email", "welcome", "login", "support_whatsapp", "extensions"]);
  if (has(settings, "v") && settings.v !== 1) p.push("versión desconocida");
  if (has(settings, "host") && settings.host !== null && !(typeof settings.host === "string" && isHost(settings.host))) p.push("la dirección no es válida: escribila sin https:// ni barras");
  if (has(settings, "from_email") && settings.from_email !== null && !(typeof settings.from_email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.from_email))) p.push("el email de «Enviar desde» no es válido");
  if (has(settings, "welcome")) {
    const w = settings.welcome;
    if (!isObj(w)) p.push("la bienvenida no es válida");
    else p.push(...unknownKeys(w, ["home_text", "invite_subject", "invite_body"]));
  }
  if (has(settings, "login")) {
    const l = settings.login;
    if (!isObj(l) || (has(l, "password_allowed") && typeof l.password_allowed !== "boolean")) p.push("«Cómo entran» no es válido");
  }
  if (has(settings, "support_whatsapp") && settings.support_whatsapp !== null && !(typeof settings.support_whatsapp === "string" && /^\+\d{6,15}$/.test(settings.support_whatsapp))) {
    p.push("el WhatsApp de soporte tiene que empezar con + y el código de país");
  }
  if (has(settings, "extensions")) {
    const e = settings.extensions;
    if (!isObj(e) || (has(e, "projects") && typeof e.projects !== "boolean")) p.push("las extensiones no son válidas");
  }
  return p;
}

/** Un nombre de host en minusculas, sin esquema, puerto ni ruta. */
export function isHost(host: string): boolean {
  return host.length <= 253 && /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
}

/** Guardar desde la pantalla nunca cambia `extensions`: lo maneja la plataforma (F43). */
export function keepExtensions(prev: unknown, next: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...next };
  delete out.extensions;
  if (isObj(prev) && has(prev, "extensions")) out.extensions = prev.extensions;
  return out;
}
