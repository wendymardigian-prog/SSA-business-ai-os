/**
 * Lo que se consulta a Meta en vivo, con cache (F58).
 *
 * No todo se puede guardar por dia. El alcance unico de un periodo no es la
 * suma de los alcances diarios: la misma persona alcanzada el lunes y el
 * martes cuenta una vez. Sumarlos da un numero inflado que despues nadie
 * entiende por que no cierra con lo que muestra Meta.
 *
 * Lo mismo con los desgloses (edad, genero, hora, placement, dispositivo):
 * guardarlos por dia y por combinacion multiplicaria la tabla por veinte
 * para algo que se mira de a un periodo por vez.
 *
 * Por eso: se piden al abrir la pantalla y se guardan **15 minutos en
 * memoria del servidor**. Es lo que dura mirar un dashboard, y evita que
 * cambiar una pestaña vuelva a gastar cuota.
 */

import { GRAPH, humanizeGraphError, type GraphError } from "./graph";
import { actionsMap, countLeads } from "./insights";

/** Cuanto vive una entrada de la cache. */
export const CACHE_TTL_MS = 15 * 60 * 1000;

interface Entry {
  value: unknown;
  expires: number;
}

const cache = new Map<string, Entry>();

/**
 * La clave de cache: cuenta, nivel, objeto y periodo.
 *
 * Los cuatro importan. Sin el objeto, abrir dos campañas devolveria los
 * datos de la primera; sin el periodo, cambiar de mes no cambiaria nada.
 */
export function cacheKey(params: {
  adAccountId: string;
  kind: string;
  objectId: string;
  since: string;
  until: string;
}): string {
  return [params.adAccountId, params.kind, params.objectId, params.since, params.until].join("|");
}

export function readCache<T>(key: string, now = Date.now()): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires <= now) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function writeCache(key: string, value: unknown, now = Date.now()): void {
  cache.set(key, { value, expires: now + CACHE_TTL_MS });
}

/** Para los tests y para forzar una lectura nueva. */
export function clearLiveCache(): void {
  cache.clear();
}

export type LiveResult<T> = { ok: true; data: T; fromCache: boolean } | { ok: false; error: string };

/**
 * Pide algo a Meta pasando por la cache.
 *
 * Cada tarjeta llama a esto por su cuenta: si el desglose por edad falla,
 * las demas se muestran igual. Un error de una tarjeta no puede vaciar la
 * pantalla.
 */
export async function liveQuery<T>(params: {
  key: string;
  token: string;
  path: string;
  query: Record<string, string>;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<LiveResult<T>> {
  const now = params.now ?? Date.now();
  const cached = readCache<T>(params.key, now);
  if (cached !== null) return { ok: true, data: cached, fromCache: true };

  const url = new URL(`${GRAPH}/${params.path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params.query)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", params.token);

  try {
    const response = await (params.fetchImpl ?? fetch)(url.toString());
    const body = (await response.json()) as T & { error?: GraphError };
    if (body?.error) return { ok: false, error: humanizeGraphError(body.error) };
    if (!response.ok) return { ok: false, error: `Meta respondio ${response.status}` };

    writeCache(params.key, body, now);
    return { ok: true, data: body as T, fromCache: false };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface UniqueReach {
  reach: number | null;
  frequency: number | null;
  impressions: number | null;
}

/**
 * El alcance unico del periodo.
 *
 * Sin `time_increment`: eso es lo que hace que Meta devuelva UN numero para
 * todo el rango, contando cada persona una vez.
 */
export async function fetchUniqueReach(params: {
  token: string;
  adAccountId: string;
  objectId?: string;
  since: string;
  until: string;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<LiveResult<UniqueReach>> {
  const target = params.objectId ?? params.adAccountId;

  const result = await liveQuery<{ data?: Array<{ reach?: string; frequency?: string; impressions?: string }> }>({
    key: cacheKey({
      adAccountId: params.adAccountId,
      kind: "reach",
      objectId: target,
      since: params.since,
      until: params.until,
    }),
    token: params.token,
    path: `${target}/insights`,
    query: {
      fields: "reach,frequency,impressions",
      time_range: JSON.stringify({ since: params.since, until: params.until }),
    },
    fetchImpl: params.fetchImpl,
    now: params.now,
  });

  if (!result.ok) return result;

  const row = result.data.data?.[0];
  const num = (v: unknown) => (v === undefined || v === null ? null : Number(v));

  return {
    ok: true,
    fromCache: result.fromCache,
    data: {
      reach: num(row?.reach),
      frequency: num(row?.frequency),
      impressions: num(row?.impressions),
    },
  };
}

/**
 * El alcance unico de cada campaña, conjunto o anuncio del periodo.
 *
 * Es el mismo problema que `fetchUniqueReach`, uno por fila de las tablas:
 * sumar los alcances diarios de una campaña cuenta a la misma persona una
 * vez por dia. Una sola consulta con `level` trae todos los objetos.
 */
export async function fetchReachByLevel(params: {
  token: string;
  adAccountId: string;
  /** Desde donde se pide: la cuenta, o una campaña/conjunto para sus hijos. */
  objectId?: string;
  level: "campaign" | "adset" | "ad";
  since: string;
  until: string;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<LiveResult<Record<string, number>>> {
  const target = params.objectId ?? params.adAccountId;
  const idField = `${params.level}_id`;

  const result = await liveQuery<{ data?: Array<Record<string, unknown>> }>({
    key: cacheKey({
      adAccountId: params.adAccountId,
      kind: `reach:${params.level}`,
      objectId: target,
      since: params.since,
      until: params.until,
    }),
    token: params.token,
    path: `${target}/insights`,
    query: {
      level: params.level,
      fields: `${idField},reach`,
      time_range: JSON.stringify({ since: params.since, until: params.until }),
      limit: "500",
    },
    fetchImpl: params.fetchImpl,
    now: params.now,
  });

  if (!result.ok) return result;

  const byId: Record<string, number> = {};
  for (const row of result.data.data ?? []) {
    const id = row[idField];
    const reach = row.reach === undefined || row.reach === null ? NaN : Number(row.reach);
    if (typeof id === "string" && Number.isFinite(reach)) byId[id] = reach;
  }
  return { ok: true, fromCache: result.fromCache, data: byId };
}

export type BreakdownKind =
  | "age,gender"
  | "publisher_platform"
  | "publisher_platform,platform_position"
  | "impression_device"
  | "device_platform"
  | "hourly_stats_aggregated_by_advertiser_time_zone";

export interface BreakdownRow {
  /** Como se llama la fila, ya en castellano donde corresponde. */
  key: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  reach: number | null;
  /** Con la misma regla que el sync (`countLeads`). */
  leads: number | null;
  actions: Record<string, number>;
  /** Cada dimension en su campo, para no tener que partir `key`. */
  age: string | null;
  gender: string | null;
  platform: string | null;
  position: string | null;
  device: string | null;
  /** La hora (0-23) del desglose horario. */
  hour: number | null;
}

/** Un desglose del periodo (edad y genero, placement, dispositivo, hora). */
export async function fetchBreakdown(params: {
  token: string;
  adAccountId: string;
  objectId?: string;
  breakdown: BreakdownKind;
  since: string;
  until: string;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<LiveResult<BreakdownRow[]>> {
  const target = params.objectId ?? params.adAccountId;

  const result = await liveQuery<{ data?: Array<Record<string, unknown>> }>({
    key: cacheKey({
      adAccountId: params.adAccountId,
      kind: `breakdown:${params.breakdown}`,
      objectId: target,
      since: params.since,
      until: params.until,
    }),
    token: params.token,
    path: `${target}/insights`,
    query: {
      fields: "spend,impressions,clicks,ctr,reach,actions",
      breakdowns: params.breakdown,
      time_range: JSON.stringify({ since: params.since, until: params.until }),
      limit: "200",
    },
    fetchImpl: params.fetchImpl,
    now: params.now,
  });

  if (!result.ok) return result;

  const num = (v: unknown) => (v === undefined || v === null ? null : Number(v));
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);

  return {
    ok: true,
    fromCache: result.fromCache,
    data: (result.data.data ?? []).map((row) => {
      const actions = row.actions as Array<{ action_type?: string; value?: string | number }> | undefined;
      return {
        key: breakdownKeyOf(row, params.breakdown),
        spend: num(row.spend),
        impressions: num(row.impressions),
        clicks: num(row.clicks),
        ctr: num(row.ctr),
        reach: num(row.reach),
        leads: countLeads(actions),
        actions: actionsMap(actions),
        age: text(row.age),
        gender: text(row.gender),
        platform: text(row.publisher_platform),
        position: text(row.platform_position),
        device: text(row.device_platform) ?? text(row.impression_device),
        hour: parseHour(row.hourly_stats_aggregated_by_advertiser_time_zone),
      };
    }),
  };
}

/**
 * La hora de una fila del desglose horario.
 *
 * Meta la manda como texto, `"14:00:00 - 14:59:59"`; pasarla por `Number()`
 * da `NaN` y la fila se pierde.
 */
export function parseHour(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value < 24 ? value : null;
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2})/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  return hour >= 0 && hour < 24 ? hour : null;
}

/** Como se llama cada fila del desglose. */
export function breakdownKeyOf(row: Record<string, unknown>, breakdown: BreakdownKind): string {
  if (breakdown === "age,gender") {
    return `${row.age ?? "?"} · ${genderLabel(String(row.gender ?? ""))}`;
  }
  if (breakdown === "publisher_platform") return String(row.publisher_platform ?? "?");
  if (breakdown === "publisher_platform,platform_position") {
    return `${row.publisher_platform ?? "?"} · ${row.platform_position ?? "?"}`;
  }
  if (breakdown === "impression_device") return String(row.impression_device ?? "?");
  if (breakdown === "device_platform") return String(row.device_platform ?? "?");
  return String(row.hourly_stats_aggregated_by_advertiser_time_zone ?? "?");
}

function genderLabel(gender: string): string {
  if (gender === "female") return "Mujeres";
  if (gender === "male") return "Varones";
  return "Sin especificar";
}

export interface ObjectMeta {
  objective: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  status: string | null;
  creative: {
    title: string | null;
    body: string | null;
    thumbnailUrl: string | null;
    cta: string | null;
    /** VIDEO, PHOTO, SHARE o STATUS: de que tipo es el creativo. */
    objectType: string | null;
  } | null;
}

/**
 * Lo que no cambia por dia: objetivo, presupuesto, estado y creativo.
 *
 * No se guarda porque no es una serie: es como esta configurado el objeto
 * AHORA. Guardarlo por dia seria guardar la misma fila treinta veces.
 *
 * Los presupuestos de Meta vienen en centavos.
 */
export async function fetchObjectMeta(params: {
  token: string;
  adAccountId: string;
  objectId: string;
  level: "campaign" | "adset" | "ad";
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<LiveResult<ObjectMeta>> {
  const fields =
    params.level === "campaign"
      ? "objective,daily_budget,lifetime_budget,effective_status"
      : params.level === "adset"
        ? "daily_budget,lifetime_budget,effective_status,optimization_goal"
        : "effective_status,creative{title,body,thumbnail_url,call_to_action_type,object_type}";

  const result = await liveQuery<{
    objective?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    effective_status?: string;
    creative?: {
      title?: string;
      body?: string;
      thumbnail_url?: string;
      call_to_action_type?: string;
      object_type?: string;
    };
  }>({
    key: cacheKey({
      adAccountId: params.adAccountId,
      kind: `meta:${params.level}`,
      objectId: params.objectId,
      since: "-",
      until: "-",
    }),
    token: params.token,
    path: params.objectId,
    query: { fields },
    fetchImpl: params.fetchImpl,
    now: params.now,
  });

  if (!result.ok) return result;

  // Meta manda los presupuestos en centavos.
  const cents = (v: unknown) => {
    const n = v === undefined || v === null ? null : Number(v);
    return n === null || !Number.isFinite(n) ? null : n / 100;
  };

  return {
    ok: true,
    fromCache: result.fromCache,
    data: {
      objective: result.data.objective ?? null,
      dailyBudget: cents(result.data.daily_budget),
      lifetimeBudget: cents(result.data.lifetime_budget),
      status: result.data.effective_status ?? null,
      creative: result.data.creative
        ? {
            title: result.data.creative.title ?? null,
            body: result.data.creative.body ?? null,
            thumbnailUrl: result.data.creative.thumbnail_url ?? null,
            cta: result.data.creative.call_to_action_type ?? null,
            objectType: result.data.creative.object_type ?? null,
          }
        : null,
    },
  };
}
