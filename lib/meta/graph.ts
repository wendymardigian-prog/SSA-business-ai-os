/**
 * Acceso a la Graph API de Meta (F40, F43, F55).
 *
 * Portado de un sistema anterior (`supabase/functions/_shared/instagram-graph.ts`),
 * adaptado a este proyecto: el token sale de Vault y no de una variable de
 * entorno, y no hay nada de Deno.
 *
 * La decision que hereda y vale la pena repetir: **un error del grafo vuelve
 * como resultado, nunca como excepcion**. Meta devuelve 200 con un `error`
 * adentro para cosas que no son fallas (un insight que esa cuenta no
 * soporta), y quien llama tiene que poder decidir si degrada o corta.
 *
 * Modulo puro: no sabe de Supabase.
 */

export const GRAPH_VERSION = "v21.0";
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Permisos que el System User tiene que traer del Business Manager. */
export const SYSTEM_USER_SCOPES = [
  "instagram_basic",
  "instagram_manage_insights",
  "instagram_manage_comments",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
  "ads_read",
] as const;

export interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
}

export type GraphResult<T> = { ok: true; data: T } | { ok: false; error: GraphError };

/** Arma una URL del grafo con el token siempre escapado. */
export function graphUrl(
  path: string,
  token: string,
  params: Record<string, string | number | undefined> = {},
): string {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("access_token", token);
  return url.toString();
}

export async function graphGet<T>(
  path: string,
  token: string,
  params: Record<string, string | number | undefined> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<GraphResult<T>> {
  try {
    const res = await fetchImpl(graphUrl(path, token, params));
    const body = (await res.json()) as T & { error?: GraphError };
    if (body?.error) return { ok: false, error: body.error };
    if (!res.ok) return { ok: false, error: { message: `HTTP ${res.status}`, code: res.status } };
    return { ok: true, data: body as T };
  } catch (err) {
    return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
  }
}

/**
 * Si conviene reintentar mas tarde.
 *
 * El 17 y el 80004 son los limites de uso de Meta: la peticion era valida y
 * en una hora va a andar. Tratarlos como un error de configuracion haria que
 * la card diga "revisá el token" cuando el token esta perfecto.
 */
export function isTransientGraphError(error: GraphError): boolean {
  if (error.code === 17 || error.code === 80004 || error.code === 4 || error.code === 32) return true;
  if (typeof error.code === "number" && error.code >= 500) return true;
  return error.type === "OAuthException" && error.code === 2;
}

/** El error del grafo, en palabras. */
export function humanizeGraphError(error: GraphError): string {
  if (isTransientGraphError(error)) {
    return "Meta nos corto por volumen de pedidos. Se reintenta mas tarde.";
  }
  if (error.code === 190) {
    return "El token de Meta no sirve mas. Generá uno nuevo en el Business Manager.";
  }
  if (error.code === 200 || error.code === 10) {
    return "Al token le falta un permiso. Revisá que tenga ads_read y los de Instagram.";
  }
  return error.message || "Meta rechazo el pedido";
}

// ── Paginas y cuenta de Instagram ────────────────────────────────────────

export interface PageNode {
  id: string;
  name?: string | null;
  instagram_business_account?: { id: string; username?: string | null } | null;
}

export interface PageCandidate {
  id: string;
  name: string | null;
  igId: string;
  igUsername: string | null;
}

/** Solo las paginas con una cuenta de Instagram profesional vinculada. */
export function pagesWithInstagram(pages: PageNode[]): PageCandidate[] {
  return pages
    .filter(
      (p): p is PageNode & { instagram_business_account: { id: string; username?: string | null } } =>
        Boolean(p.instagram_business_account?.id),
    )
    .map((p) => ({
      id: p.id,
      name: p.name ?? null,
      igId: p.instagram_business_account.id,
      igUsername: p.instagram_business_account.username ?? null,
    }));
}

// ── Insights ─────────────────────────────────────────────────────────────

export interface InsightValue {
  value: number | Record<string, number>;
  end_time?: string;
}

export interface InsightNode {
  name: string;
  period?: string;
  values?: InsightValue[];
  total_value?: {
    value?: number;
    breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }>;
  };
}

/** Suma los valores de un metric. Devuelve null si el metric no vino. */
export function sumInsight(nodes: InsightNode[] | undefined, name: string): number | null {
  const node = nodes?.find((n) => n.name === name);
  // null y no 0: "no vino" es distinto de "vino en cero", y escribir un cero
  // que Meta no dijo es inventar un dato.
  if (!node) return null;
  if (typeof node.total_value?.value === "number") return node.total_value.value;
  const values = (node.values ?? []).filter((v) => typeof v.value === "number");
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc + (v.value as number), 0);
}

/** Serie diaria de un metric: `[{ date, value }]`. */
export function seriesInsight(
  nodes: InsightNode[] | undefined,
  name: string,
): Array<{ date: string; value: number }> {
  const node = nodes?.find((n) => n.name === name);
  return (node?.values ?? [])
    .filter((v) => typeof v.value === "number" && v.end_time)
    .map((v) => ({ date: (v.end_time ?? "").slice(0, 10), value: v.value as number }));
}

/**
 * Desglose demografico.
 *
 * Meta lo devuelve en `total_value.breakdowns`; el formato viejo lo traia en
 * `values[0].value`. Se aceptan los dos: cuando Meta cambie de vuelta, esto
 * sigue andando.
 */
export function breakdownInsight(
  nodes: InsightNode[] | undefined,
  name: string,
): Record<string, number> {
  const node = nodes?.find((n) => n.name === name);
  if (!node) return {};

  const results = node.total_value?.breakdowns?.[0]?.results;
  if (results?.length) {
    const out: Record<string, number> = {};
    for (const r of results) {
      const key = r.dimension_values?.[0];
      if (key) out[key] = (out[key] ?? 0) + (r.value ?? 0);
    }
    return out;
  }

  const legacy = node.values?.[0]?.value;
  if (legacy && typeof legacy === "object") return legacy as Record<string, number>;
  return {};
}
