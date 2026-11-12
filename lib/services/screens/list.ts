// @plantilla-quitar(servicios)
import { clientHref, serviceHref } from "./record-url";

/**
 * Clientes › Servicios (F26): la fila de cada servicio, los filtros en la URL y el tablero por fase. Puro.
 */

export type ServiceStatus = "pending_confirmation" | "active" | "paused" | "completed" | "cancelled";
export type Light = "green" | "yellow" | "red" | "gray";

export interface ServiceListItem {
  id: string;
  contactId: string;
  contactName: string;
  productName: string;
  variantName: string;
  ownerName: string | null;
  status: ServiceStatus;
  light: Light | null;
  lightReason: string | null;
  phaseName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  progressPct: number;
  pendingReviews: number;
  portal: "active" | "invited" | "none";
}

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const ddmm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

/** «Día 12 de 84», «Día 12» sin fin, «Pausado», «Empieza el 1/1», «Por confirmar» o el estado final. */
export function dayLabel(s: Pick<ServiceListItem, "status" | "startsOn" | "endsOn">, today: string): string {
  if (s.status === "pending_confirmation") return "Por confirmar";
  if (s.status === "paused") return "Pausado";
  if (s.status === "completed") return "Completado";
  if (s.status === "cancelled") return "Cancelado";
  if (!s.startsOn) return "Sin fecha de inicio";
  if (utc(s.startsOn) > utc(today)) return `Empieza el ${ddmm(s.startsOn)}`;
  const day = Math.floor((utc(today) - utc(s.startsOn)) / DAY) + 1;
  if (!s.endsOn) return `Día ${day}`;
  const total = Math.floor((utc(s.endsOn) - utc(s.startsOn)) / DAY) + 1;
  return `Día ${Math.min(day, total)} de ${total}`;
}

export const LIGHT_LABELS: Record<Light, string> = { green: "En verde", yellow: "Amarillo", red: "Rojo", gray: "Gris" };
export const STATUS_LABELS: Record<ServiceStatus, string> = {
  pending_confirmation: "Por confirmar",
  active: "Activo",
  paused: "Pausado",
  completed: "Completado",
  cancelled: "Cancelado",
};
export const PORTAL_LABELS: Record<ServiceListItem["portal"], string> = { active: "Activo", invited: "Invitado", none: "Sin portal" };

export function serviceRowView(s: ServiceListItem, today: string) {
  return {
    id: s.id,
    href: serviceHref(s.id),
    clientHref: clientHref(s.contactId),
    client: s.contactName,
    product: s.variantName ? `${s.productName} · ${s.variantName}` : s.productName,
    owner: s.ownerName ?? "Sin responsable",
    light: s.light ?? "gray",
    lightLabel: LIGHT_LABELS[s.light ?? "gray"],
    lightReason: s.lightReason ?? "",
    phase: s.phaseName ?? "—",
    day: dayLabel(s, today),
    progress: `${Math.round(s.progressPct)}%`,
    portal: PORTAL_LABELS[s.portal],
    reviewChip: pendingReviewChip(s.pendingReviews, s.contactId),
  };
}

/** «N por revisar» junto al cliente; con 0, nada. Lleva a Portal › Por revisar filtrado por ese estudiante. */
export function pendingReviewChip(n: number, contactId: string): { label: string; href: string } | null {
  if (!n || n <= 0) return null;
  return { label: `${n} por revisar`, href: `/dashboard/portal/por-revisar?cliente=${contactId}` };
}

// ── Filtros en la URL ───────────────────────────────────────────────────────
export const QUICK_FILTERS = ["all", "red", "yellow", "pending", "expiring", "reviews"] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number];
export const QUICK_FILTER_LABELS: Record<QuickFilter, string> = {
  all: "Todos",
  red: "Rojo",
  yellow: "Amarillo",
  pending: "Por confirmar",
  expiring: "Accesos por vencer",
  reviews: "Entregas por revisar",
};
export const GROUP_BY = ["none", "phase", "light", "owner"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export interface ServiceFilters {
  view: "table" | "board";
  quick: QuickFilter;
  groupBy: GroupBy;
  q: string;
  page: number;
  owner: string | null;
  departedOnly: boolean;
}

export const DEFAULT_FILTERS: ServiceFilters = { view: "table", quick: "all", groupBy: "none", q: "", page: 1, owner: null, departedOnly: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseServiceFilters(params: URLSearchParams | Record<string, string | undefined>): ServiceFilters {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : params[k]) ?? null;
  const quick = get("f");
  const group = get("agrupar");
  const page = Number(get("pagina"));
  const owner = get("responsable");
  return {
    // `?modo=tablero` (Servicios A2: `vista` es de las vistas guardadas); el link viejo `?vista=tablero` se sigue entendiendo.
    view: get("modo") === "tablero" || get("vista") === "tablero" ? "board" : "table",
    quick: (QUICK_FILTERS as readonly string[]).includes(quick ?? "") ? (quick as QuickFilter) : "all",
    groupBy: (GROUP_BY as readonly string[]).includes(group ?? "") ? (group as GroupBy) : "none",
    q: (get("q") ?? "").slice(0, 100),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    owner: owner && UUID.test(owner) ? owner : null,
    departedOnly: get("baja") === "1",
  };
}

export function serializeServiceFilters(f: ServiceFilters): string {
  const p = new URLSearchParams();
  if (f.view === "board") p.set("modo", "tablero");
  if (f.quick !== "all") p.set("f", f.quick);
  if (f.groupBy !== "none") p.set("agrupar", f.groupBy);
  if (f.q) p.set("q", f.q);
  if (f.page > 1) p.set("pagina", String(f.page));
  if (f.owner) p.set("responsable", f.owner);
  if (f.departedOnly) p.set("baja", "1");
  return p.toString();
}

export const PAGE_SIZE = 50;

// ── Tablero por fase y agrupar ──────────────────────────────────────────────
export function groupServices<T extends Pick<ServiceListItem, "phaseName" | "light" | "ownerName" | "status">>(items: T[], by: GroupBy): Array<{ key: string; label: string; items: T[] }> {
  if (by === "none") return [{ key: "all", label: "Todos", items }];
  const keyOf = (s: T) =>
    by === "phase" ? s.phaseName ?? (s.status === "pending_confirmation" ? "Por confirmar" : "Sin fase") : by === "light" ? LIGHT_LABELS[s.light ?? "gray"] : s.ownerName ?? "Sin responsable";
  const groups = new Map<string, T[]>();
  for (const s of items) groups.set(keyOf(s), [...(groups.get(keyOf(s)) ?? []), s]);
  const order = by === "light" ? ["Rojo", "Amarillo", "En verde", "Gris"] : [...groups.keys()];
  return order.filter((k) => groups.has(k)).map((k) => ({ key: k, label: k, items: groups.get(k)! }));
}
