// @plantilla-quitar(servicios)
/**
 * Las fichas del cliente y del servicio se abren en un modal encima de Clientes (Servicios A2, F130.2 y F130.3), por
 * la URL: `?cliente=<contacto>` y `?servicio=<servicio>`. Los links viejos (`/dashboard/clientes/c/<id>` y
 * `/dashboard/clientes/s/<id>`) redirigen aca, asi no se rompe ninguno. Puro.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CLIENTS_BASE = "/dashboard/clientes";

/** La columna derecha de la ficha del servicio: el camino o la actividad. */
export type ServiceRecordTab = "camino" | "actividad";

export function serviceHref(serviceId: string, opts: { tab?: ServiceRecordTab; base?: string } = {}): string {
  const p = new URLSearchParams({ servicio: serviceId });
  if (opts.tab && opts.tab !== "camino") p.set("panel", opts.tab);
  return `${opts.base ?? CLIENTS_BASE}?${p}`;
}

export function clientHref(contactId: string, opts: { base?: string } = {}): string {
  return `${opts.base ?? CLIENTS_BASE}?${new URLSearchParams({ cliente: contactId })}`;
}

export type RecordParams =
  | { kind: "service"; id: string; tab: ServiceRecordTab }
  | { kind: "client"; id: string }
  | { kind: "none" };

/** Que ficha pide la URL. Un id que no es un uuid no abre nada. El servicio gana si vinieran los dos. */
export function parseRecordParams(params: URLSearchParams | Record<string, string | string[] | undefined>): RecordParams {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return Array.isArray(v) ? v[0] ?? null : v ?? null;
  };
  const service = get("servicio");
  if (service && UUID.test(service)) return { kind: "service", id: service, tab: get("panel") === "actividad" ? "actividad" : "camino" };
  const client = get("cliente");
  if (client && UUID.test(client)) return { kind: "client", id: client };
  return { kind: "none" };
}

/** La URL sin la ficha (para cerrarla): conserva los filtros de la lista. */
export function withoutRecord(pathname: string, params: URLSearchParams | string): string {
  const p = new URLSearchParams(typeof params === "string" ? params : params.toString());
  p.delete("servicio");
  p.delete("cliente");
  p.delete("panel");
  const qs = p.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** La URL con una ficha abierta, conservando los filtros de la lista (y sacando la otra ficha). */
export function withRecord(pathname: string, params: URLSearchParams | string, record: { kind: "service"; id: string; tab?: ServiceRecordTab } | { kind: "client"; id: string }): string {
  const p = new URLSearchParams(withoutRecord("", params).replace(/^\?/, ""));
  if (record.kind === "service") {
    p.set("servicio", record.id);
    if (record.tab === "actividad") p.set("panel", "actividad");
  } else p.set("cliente", record.id);
  return `${pathname}?${p}`;
}

/** El link viejo de la ficha del servicio, traducido (su `?tab=actividad` sigue abriendo la actividad). */
export function legacyServiceRedirect(serviceId: string, tab: string | undefined): string {
  return serviceHref(serviceId, { tab: tab === "actividad" ? "actividad" : "camino" });
}
