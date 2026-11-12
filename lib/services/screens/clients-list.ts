// @plantilla-quitar(servicios)
/**
 * Clientes › pestaña Clientes (Servicios A2, F130.1): una fila por contacto con al menos un servicio, con el peor
 * semaforo de sus servicios activos, las entregas por revisar, cuantos servicios activos, el avance, el ultimo ingreso
 * al portal y el total cobrado. Tabla o tablero, agrupar por semaforo, responsable o portal, ordenar y filtrar: todo
 * en el navegador, sin recargar. Puro.
 */
import type { Light, ServiceStatus } from "./list";

export interface ClientServiceInput {
  contactId: string;
  status: ServiceStatus;
  light: Light | null;
  progressPct: number;
  ownerName: string | null;
  hasPortal: boolean;
}

export interface ClientPortalInput {
  accountStatus: string | null;
  lastLoginAt: string | null;
  pendingReviews: number;
}

export type ClientLight = Light | "pending" | "none";
export type PortalGroup = "week" | "stale" | "invited" | "never" | "none";

export interface ClientRow {
  contactId: string;
  name: string;
  light: ClientLight;
  pendingReviews: number;
  activeCount: number;
  progressPct: number | null;
  owners: string[];
  hasPortal: boolean;
  lastLoginAt: string | null;
  portalGroup: PortalGroup;
  paidCents: number | null;
}

const RUNNING: ServiceStatus[] = ["active", "paused"];
const LIGHT_RANK: Record<ClientLight, number> = { red: 0, yellow: 1, pending: 2, green: 3, gray: 4, none: 5 };
const WEEK = 7 * 86_400_000;

/** El peor semaforo de sus servicios activos; "Por confirmar" aparte (si solo tiene servicios por confirmar). */
export function worstLight(services: readonly Pick<ClientServiceInput, "status" | "light">[]): ClientLight {
  const running = services.filter((s) => RUNNING.includes(s.status));
  if (running.length) return running.map((s) => (s.light ?? "gray") as ClientLight).sort((a, b) => LIGHT_RANK[a] - LIGHT_RANK[b])[0];
  if (services.some((s) => s.status === "pending_confirmation")) return "pending";
  return "none";
}

/** Entró esta semana, más de 7 días sin entrar, invitada sin entrar, cuenta sin ingreso o sin portal. */
export function portalGroupOf(hasPortal: boolean, p: ClientPortalInput | null | undefined, nowIso: string): PortalGroup {
  if (!hasPortal || !p?.accountStatus) return "none";
  if (p.lastLoginAt) return Date.parse(nowIso) - Date.parse(p.lastLoginAt) <= WEEK ? "week" : "stale";
  return p.accountStatus === "invited" ? "invited" : "never";
}

export function buildClientRows(input: {
  services: readonly ClientServiceInput[];
  names: ReadonlyMap<string, string>;
  portal: ReadonlyMap<string, ClientPortalInput>;
  paidCents: ReadonlyMap<string, number>;
  nowIso: string;
}): ClientRow[] {
  const byContact = new Map<string, ClientServiceInput[]>();
  for (const s of input.services) byContact.set(s.contactId, [...(byContact.get(s.contactId) ?? []), s]);
  return [...byContact.entries()].map(([contactId, list]) => {
    const running = list.filter((s) => RUNNING.includes(s.status));
    const hasPortal = list.some((s) => s.hasPortal);
    const p = input.portal.get(contactId) ?? null;
    return {
      contactId,
      name: input.names.get(contactId) ?? "Sin nombre",
      light: worstLight(list),
      pendingReviews: hasPortal ? Number(p?.pendingReviews ?? 0) : 0,
      activeCount: running.length,
      progressPct: running.length ? Math.round(running.reduce((n, s) => n + (Number(s.progressPct) || 0), 0) / running.length) : null,
      owners: [...new Set(running.map((s) => s.ownerName ?? "Sin responsable"))],
      hasPortal,
      lastLoginAt: hasPortal ? p?.lastLoginAt ?? null : null,
      portalGroup: portalGroupOf(hasPortal, p, input.nowIso),
      paidCents: input.paidCents.has(contactId) ? input.paidCents.get(contactId)! : null,
    };
  });
}

// ── Filtro rapido, busqueda, orden y grupos ────────────────────────────────
export const CLIENT_QUICK = ["all", "red", "yellow", "pending", "reviews", "stale"] as const;
export type ClientQuick = (typeof CLIENT_QUICK)[number];
export const CLIENT_QUICK_LABELS: Record<ClientQuick, string> = {
  all: "Todos",
  red: "Rojo",
  yellow: "Amarillo",
  pending: "Por confirmar",
  reviews: "Entregas por revisar",
  stale: "Más de 7 días sin entrar",
};

export function matchesClientQuick(r: ClientRow, q: ClientQuick): boolean {
  switch (q) {
    case "all":
      return true;
    case "red":
    case "yellow":
    case "pending":
      return r.light === q;
    case "reviews":
      return r.pendingReviews > 0;
    case "stale":
      return r.portalGroup === "stale";
  }
}

/** Las opciones del filtro rapido con su conteo. Las del portal solo si algun cliente tiene portal. */
export function clientQuickOptions(rows: readonly ClientRow[]): Array<{ key: ClientQuick; label: string; count: number }> {
  const anyPortal = rows.some((r) => r.hasPortal);
  return CLIENT_QUICK.filter((k) => anyPortal || (k !== "reviews" && k !== "stale")).map((k) => ({ key: k, label: CLIENT_QUICK_LABELS[k], count: rows.filter((r) => matchesClientQuick(r, k)).length }));
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function searchClients(rows: readonly ClientRow[], q: string): ClientRow[] {
  const needle = fold(q.trim());
  return needle ? rows.filter((r) => fold(r.name).includes(needle)) : [...rows];
}

export const CLIENT_SORT = ["name", "light", "active", "progress", "login", "paid"] as const;
export type ClientSort = (typeof CLIENT_SORT)[number];

export function sortClients(rows: readonly ClientRow[], key: ClientSort, dir: "asc" | "desc"): ClientRow[] {
  const sign = dir === "asc" ? 1 : -1;
  // Lo que no tiene dato va siempre al final, en los dos sentidos.
  const nullable = (a: number | null, b: number | null) => (a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : sign * (a - b));
  const cmp = (a: ClientRow, b: ClientRow): number => {
    switch (key) {
      case "name":
        return sign * a.name.localeCompare(b.name, "es");
      case "light":
        return sign * (LIGHT_RANK[a.light] - LIGHT_RANK[b.light]);
      case "active":
        return sign * (a.activeCount - b.activeCount);
      case "progress":
        return nullable(a.progressPct, b.progressPct);
      case "login":
        return nullable(a.lastLoginAt ? Date.parse(a.lastLoginAt) : null, b.lastLoginAt ? Date.parse(b.lastLoginAt) : null);
      case "paid":
        return nullable(a.paidCents, b.paidCents);
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name, "es"));
}

export const CLIENT_GROUP = ["none", "light", "owner", "portal"] as const;
export type ClientGroup = (typeof CLIENT_GROUP)[number];
export const CLIENT_GROUP_LABELS: Record<ClientGroup, string> = { none: "Sin agrupar", light: "Semáforo", owner: "Responsable", portal: "Portal" };

const LIGHT_GROUP_LABELS: Record<ClientLight, string> = { red: "Rojo", yellow: "Amarillo", pending: "Por confirmar", green: "Verde", gray: "Gris", none: "Sin servicios activos" };
const PORTAL_GROUP_LABELS: Record<PortalGroup, string> = { week: "Entró esta semana", stale: "Más de 7 días sin entrar", invited: "Invitada sin entrar", never: "Con cuenta, sin entrar", none: "Sin portal" };
const PORTAL_ORDER: PortalGroup[] = ["stale", "invited", "never", "week", "none"];
const LIGHT_ORDER: ClientLight[] = ["red", "yellow", "pending", "green", "gray", "none"];

/** Los grupos (y las columnas del tablero). La suma de los grupos es el total, salvo por responsable (un cliente con
 *  dos responsables aparece en los dos). */
export function groupClients(rows: readonly ClientRow[], by: ClientGroup): Array<{ key: string; label: string; rows: ClientRow[] }> {
  if (by === "none") return [{ key: "all", label: "Todos", rows: [...rows] }];
  if (by === "light") return LIGHT_ORDER.map((k) => ({ key: k, label: LIGHT_GROUP_LABELS[k], rows: rows.filter((r) => r.light === k) })).filter((g) => g.rows.length > 0);
  if (by === "portal") return PORTAL_ORDER.map((k) => ({ key: k, label: PORTAL_GROUP_LABELS[k], rows: rows.filter((r) => r.portalGroup === k) })).filter((g) => g.rows.length > 0);
  const owners = new Map<string, ClientRow[]>();
  for (const r of rows) for (const o of r.owners.length ? r.owners : ["Sin responsable"]) owners.set(o, [...(owners.get(o) ?? []), r]);
  return [...owners.entries()].sort((a, b) => (a[0] === "Sin responsable" ? 1 : b[0] === "Sin responsable" ? -1 : a[0].localeCompare(b[0], "es"))).map(([k, v]) => ({ key: `o:${k}`, label: k, rows: v }));
}

export interface ClientsUrlState {
  mode: "table" | "board";
  quick: ClientQuick;
  group: ClientGroup;
  q: string;
}

/** La lista de Clientes en la URL (`?modo=tablero&f=red&agrupar=portal&q=`). `vista=tablero` (el link viejo) se sigue entendiendo. */
export function parseClientsUrl(params: Record<string, string | string[] | undefined> | URLSearchParams): ClientsUrlState {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return (Array.isArray(v) ? v[0] : v) ?? null;
  };
  const f = get("f");
  const g = get("agrupar");
  return {
    mode: get("modo") === "tablero" || get("vista") === "tablero" ? "board" : "table",
    quick: (CLIENT_QUICK as readonly string[]).includes(f ?? "") ? (f as ClientQuick) : "all",
    group: (CLIENT_GROUP as readonly string[]).includes(g ?? "") ? (g as ClientGroup) : "none",
    q: (get("q") ?? "").slice(0, 100),
  };
}

export function serializeClientsUrl(s: ClientsUrlState): string {
  const p = new URLSearchParams();
  if (s.mode === "board") p.set("modo", "tablero");
  if (s.quick !== "all") p.set("f", s.quick);
  if (s.group !== "none") p.set("agrupar", s.group);
  if (s.q) p.set("q", s.q);
  return p.toString();
}
