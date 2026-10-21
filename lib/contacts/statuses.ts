/**
 * Los estados del pipeline de contactos: uno del SETTER y uno del VENDEDOR
 * (closer), cada uno con su lista editable en Ajustes → Estados.
 *
 * Las listas viven en `workspaces.contact_status_settings` (jsonb, 00245):
 * `{ setter: Status[], closer: Status[] }`, con `{ key, name, color, archived_at }`.
 * El orden es el de la lista.
 *
 *  - `key` NO cambia nunca: es lo que guardan los contactos y el historial.
 *  - un estado no se borra: se archiva. Uno archivado no se ofrece para
 *    contactos nuevos, pero el que ya lo tiene lo conserva y se ve con
 *    "(archivado)".
 *  - el ÚLTIMO estado del contacto es el que se cambió más recientemente de
 *    los dos (`deriveLastStatus`, gemela del cálculo de `set_contact_status`).
 *
 * Puro: sin base ni React.
 */
import { z } from "zod";

export const STATUS_ROLES = ["setter", "closer"] as const;
export type StatusRole = (typeof STATUS_ROLES)[number];

export const STATUS_ROLE_LABELS: Record<StatusRole, string> = {
  setter: "Setter",
  closer: "Vendedor",
};

export function isStatusRole(value: unknown): value is StatusRole {
  return value === "setter" || value === "closer";
}

/** La paleta que ofrece la pantalla (la misma de las categorías de gasto). */
export const STATUS_COLORS = [
  "#64748b", "#2563eb", "#0891b2", "#0d9488", "#16a34a", "#ca8a04", "#ea580c", "#e11d48", "#db2777", "#7c3aed", "#4f46e5", "#78716c",
] as const;

export interface ContactStatus {
  key: string;
  name: string;
  color: string;
  archived_at: string | null;
}

export type ContactStatusSettings = Record<StatusRole, ContactStatus[]>;

export const STATUS_KEY_RE = /^[a-z0-9_]{2,40}$/;
export const STATUS_NAME_MAX = 60;
export const STATUS_MAX_PER_ROLE = 30;

export const contactStatusSchema = z.object({
  key: z.string().regex(STATUS_KEY_RE),
  name: z.string().trim().min(1).max(STATUS_NAME_MAX),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  archived_at: z.string().nullable(),
});

/**
 * Los estados con los que arranca un workspace. La MISMA lista es el default de
 * la columna en la migración 00245 (un test las compara).
 */
export const DEFAULT_CONTACT_STATUSES: Readonly<ContactStatusSettings> = {
  setter: [
    { key: "nuevo", name: "Nuevo", color: "#64748b", archived_at: null },
    { key: "contactado", name: "Contactado", color: "#2563eb", archived_at: null },
    { key: "en_conversacion", name: "En conversación", color: "#0891b2", archived_at: null },
    { key: "calificado", name: "Calificado", color: "#16a34a", archived_at: null },
    { key: "agendado", name: "Agendado", color: "#7c3aed", archived_at: null },
    { key: "no_calificado", name: "No calificado", color: "#ca8a04", archived_at: null },
    { key: "perdido", name: "Perdido", color: "#e11d48", archived_at: null },
  ],
  closer: [
    { key: "llamada_agendada", name: "Llamada agendada", color: "#7c3aed", archived_at: null },
    { key: "no_se_presento", name: "No se presentó", color: "#ca8a04", archived_at: null },
    { key: "en_seguimiento", name: "En seguimiento", color: "#0891b2", archived_at: null },
    { key: "propuesta_enviada", name: "Propuesta enviada", color: "#2563eb", archived_at: null },
    { key: "ganado", name: "Ganado", color: "#16a34a", archived_at: null },
    { key: "perdido", name: "Perdido", color: "#e11d48", archived_at: null },
  ],
};

function cloneDefaults(role: StatusRole): ContactStatus[] {
  return DEFAULT_CONTACT_STATUSES[role].map((s) => ({ ...s }));
}

function parseList(json: unknown, role: StatusRole): ContactStatus[] {
  if (!Array.isArray(json)) return cloneDefaults(role);
  const seen = new Set<string>();
  const out: ContactStatus[] = [];
  for (const raw of json) {
    const parsed = contactStatusSchema.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data.key)) continue;
    seen.add(parsed.data.key);
    out.push(parsed.data);
  }
  return out;
}

/**
 * Lee lo guardado. Nunca lanza: una entrada inválida se descarta. Una lista
 * que NO está (workspace viejo, jsonb vacío) arranca con los estados por
 * defecto; una lista vacía a propósito se respeta.
 */
export function parseStatusSettings(json: unknown): ContactStatusSettings {
  const obj = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  return {
    setter: "setter" in obj ? parseList(obj.setter, "setter") : cloneDefaults("setter"),
    closer: "closer" in obj ? parseList(obj.closer, "closer") : cloneDefaults("closer"),
  };
}

export function activeStatuses(list: readonly ContactStatus[]): ContactStatus[] {
  return list.filter((s) => !s.archived_at);
}

export function findStatus(list: readonly ContactStatus[], key: string | null | undefined): ContactStatus | null {
  if (!key) return null;
  return list.find((s) => s.key === key) ?? null;
}

/** El nombre para mostrar. Uno archivado lleva "(archivado)"; una clave desconocida se muestra tal cual. */
export function statusName(list: readonly ContactStatus[], key: string | null | undefined): string {
  if (!key) return "—";
  const s = findStatus(list, key);
  if (!s) return key;
  return s.archived_at ? `${s.name} (archivado)` : s.name;
}

/** Gris para una clave que ya no existe en la lista. */
export function statusColor(list: readonly ContactStatus[], key: string | null | undefined): string {
  return findStatus(list, key)?.color ?? "#64748b";
}

/** Clave sin tildes para un estado nuevo; si existe, `_2`, `_3`… */
export function newStatusKey(name: string, existing: readonly string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 34) || "estado";
  const root = base.length >= 2 ? base : `${base}_x`;
  const taken = new Set(existing);
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${root}_${n}`)) return `${root}_${n}`;
  return `${root}_${Date.now()}`;
}

export type StatusesUpdateResult = { ok: true } | { ok: false; error: string };

/**
 * Qué se puede hacer con una lista al guardar: no se quita un estado ni se
 * cambia su `key` (se archiva), los nombres son únicos entre los activos (sin
 * importar mayúsculas) y hay un tope por lista.
 */
export function validateStatusesUpdate(before: readonly ContactStatus[], after: readonly ContactStatus[]): StatusesUpdateResult {
  if (after.length > STATUS_MAX_PER_ROLE) return { ok: false, error: `Puede haber hasta ${STATUS_MAX_PER_ROLE} estados por lista` };
  const afterByKey = new Map(after.map((s) => [s.key, s]));
  if (afterByKey.size !== after.length) return { ok: false, error: "Hay dos estados con la misma clave" };
  for (const old of before) {
    if (!afterByKey.has(old.key)) return { ok: false, error: `No se puede borrar «${old.name}»: archivalo` };
  }
  const names = new Set<string>();
  for (const s of after) {
    if (s.archived_at) continue;
    const n = s.name.trim().toLowerCase();
    if (names.has(n)) return { ok: false, error: `Hay dos estados que se llaman «${s.name}»` };
    names.add(n);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// El último estado
// ---------------------------------------------------------------------------

export interface ContactStatusState {
  setter_status: string | null;
  setter_status_at: string | null;
  closer_status: string | null;
  closer_status_at: string | null;
}

export interface LastStatus {
  role: StatusRole;
  status: string;
  at: string;
}

/**
 * El último estado: el de fecha más reciente entre los dos que tienen valor.
 * Con la misma fecha gana el del vendedor (es el que está más cerca del
 * cierre). Sin ninguno, null. Es la gemela de lo que calcula
 * `set_contact_status` en la base.
 */
export function deriveLastStatus(state: ContactStatusState): LastStatus | null {
  const candidates: LastStatus[] = [];
  if (state.setter_status && state.setter_status_at) candidates.push({ role: "setter", status: state.setter_status, at: state.setter_status_at });
  if (state.closer_status && state.closer_status_at) candidates.push({ role: "closer", status: state.closer_status, at: state.closer_status_at });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const diff = new Date(b.at).getTime() - new Date(a.at).getTime();
    if (diff !== 0) return diff;
    return a.role === "closer" ? -1 : 1;
  });
  return candidates[0];
}

/** El filtro `?estado=setter:calificado` de la lista de contactos. */
export function parseLastStatusParam(raw: string | null | undefined): { role: StatusRole; key: string } | null {
  if (!raw) return null;
  const [role, key] = raw.split(":");
  if (!isStatusRole(role) || !key || !STATUS_KEY_RE.test(key)) return null;
  return { role, key };
}

export function lastStatusParam(role: StatusRole, key: string): string {
  return `${role}:${key}`;
}

// ---------------------------------------------------------------------------
// La pantalla de Ajustes → Estados (lo que manda `saveContactStatusSettings`)
// ---------------------------------------------------------------------------

export const STATUS_COLOR_NAMES: Record<(typeof STATUS_COLORS)[number], string> = {
  "#64748b": "Gris azulado",
  "#2563eb": "Azul",
  "#0891b2": "Celeste",
  "#0d9488": "Verde azulado",
  "#16a34a": "Verde",
  "#ca8a04": "Mostaza",
  "#ea580c": "Naranja",
  "#e11d48": "Rojo",
  "#db2777": "Rosa",
  "#7c3aed": "Violeta",
  "#4f46e5": "Índigo",
  "#78716c": "Gris piedra",
};

/** Lo que la pantalla le manda a la acción por cada estado. */
export interface StatusItem {
  key?: string;
  name: string;
  color: (typeof STATUS_COLORS)[number];
  archived: boolean;
}

export interface StatusDraft {
  key?: string;
  name: string;
  color: (typeof STATUS_COLORS)[number];
}

function paletteColor(color: string): (typeof STATUS_COLORS)[number] {
  const lower = color.toLowerCase();
  return (STATUS_COLORS as readonly string[]).includes(lower) ? (lower as (typeof STATUS_COLORS)[number]) : STATUS_COLORS[0];
}

export function statusItems(list: readonly ContactStatus[]): StatusItem[] {
  return list.map((s) => ({ key: s.key, name: s.name, color: paletteColor(s.color), archived: Boolean(s.archived_at) }));
}

/** La lista con el borrador aplicado: si tiene `key` reemplaza ese estado; si no, se suma al final. */
export function statusItemsWithDraft(list: readonly ContactStatus[], draft: StatusDraft): StatusItem[] {
  const items = statusItems(list);
  if (!draft.key) return [...items, { name: draft.name, color: draft.color, archived: false }];
  return items.map((i) => (i.key === draft.key ? { ...i, name: draft.name, color: draft.color } : i));
}

export function statusItemsWithArchived(list: readonly ContactStatus[], key: string, archived: boolean): StatusItem[] {
  return statusItems(list).map((i) => (i.key === key ? { ...i, archived } : i));
}

/** Sube (-1) o baja (+1) un estado un lugar. En el borde, queda igual. */
export function statusItemsMoved(list: readonly ContactStatus[], key: string, direction: -1 | 1): StatusItem[] {
  const items = statusItems(list);
  const from = items.findIndex((i) => i.key === key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= items.length) return items;
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  return items;
}

/** El error del borrador antes de mandarlo, o null. */
export function statusDraftError(draft: StatusDraft, list: readonly ContactStatus[]): string | null {
  const name = draft.name.trim();
  if (!name) return "Poné un nombre";
  if (name.length > STATUS_NAME_MAX) return `El nombre puede tener hasta ${STATUS_NAME_MAX} caracteres`;
  const clash = list.some((s) => !s.archived_at && s.key !== draft.key && s.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) return `Ya hay un estado que se llama «${name}»`;
  if (!draft.key && list.length >= STATUS_MAX_PER_ROLE) return `Puede haber hasta ${STATUS_MAX_PER_ROLE} estados por lista`;
  return null;
}
