/**
 * El dashboard unificado (F59).
 *
 * Una sola pantalla con lo organico y lo pago del mismo periodo, que es
 * como se decide de verdad: "gaste 40 mil y traje 30 leads; lo organico
 * llego a 8 mil personas sin gastar nada".
 *
 * Lo que NO hace, a proposito: **no suma el alcance organico con el pago**.
 * Meta no dice cuanta gente vio las dos cosas, asi que el total seria un
 * numero mas grande que la realidad. Se muestran uno al lado del otro.
 *
 * Y si falta una de las dos fuentes, se muestra la otra con un aviso. Una
 * pantalla vacia porque todavia no se conecto Meta esconde lo organico, que
 * si esta.
 */

export interface OrganicSummary {
  reach: number | null;
  interactions: number | null;
  followersGained: number | null;
  posts: number;
  daily: Array<{ date: string; reach: number | null }>;
}

export interface PaidSummary {
  reach: number | null;
  spend: number | null;
  leads: number | null;
  impressions: number | null;
  clicks: number | null;
  daily: Array<{ date: string; reach: number | null; spend: number | null }>;
}

export type SourceState = "ok" | "not_connected" | "no_data";

export interface UnifiedView {
  organic: OrganicSummary | null;
  paid: PaidSummary | null;
  organicState: SourceState;
  paidState: SourceState;
  /** Que avisar, en palabras. Vacio si estan las dos fuentes con datos. */
  notices: string[];
  /** La serie combinada: alcance organico y pago por dia. */
  daily: Array<{ date: string; organicReach: number | null; paidReach: number | null; spend: number | null }>;
  /** Cuanto costo cada lead pago. Null sin leads. */
  costPerLead: number | null;
}

function stateOf(connected: boolean, hasData: boolean): SourceState {
  if (!connected) return "not_connected";
  return hasData ? "ok" : "no_data";
}

export function buildUnified(params: {
  organic: OrganicSummary | null;
  paid: PaidSummary | null;
  organicConnected: boolean;
  paidConnected: boolean;
}): UnifiedView {
  const organicHasData = Boolean(params.organic && params.organic.posts > 0);
  const paidHasData = Boolean(params.paid && (params.paid.spend ?? 0) > 0);

  const organicState = stateOf(params.organicConnected, organicHasData);
  const paidState = stateOf(params.paidConnected, paidHasData);

  const notices: string[] = [];
  if (organicState === "not_connected") {
    notices.push("Todavia no hay ninguna red conectada: lo que se ve es solo lo pago.");
  } else if (organicState === "no_data") {
    notices.push("No se publico nada organico en este periodo.");
  }
  if (paidState === "not_connected") {
    notices.push("Meta Ads no esta conectado: lo que se ve es solo lo organico.");
  } else if (paidState === "no_data") {
    notices.push("No hubo gasto en anuncios en este periodo.");
  }

  const dates = [
    ...new Set([
      ...(params.organic?.daily ?? []).map((d) => d.date),
      ...(params.paid?.daily ?? []).map((d) => d.date),
    ]),
  ].sort();

  const daily = dates.map((date) => ({
    date,
    organicReach: params.organic?.daily.find((d) => d.date === date)?.reach ?? null,
    paidReach: params.paid?.daily.find((d) => d.date === date)?.reach ?? null,
    spend: params.paid?.daily.find((d) => d.date === date)?.spend ?? null,
  }));

  const spend = params.paid?.spend ?? null;
  const leads = params.paid?.leads ?? null;

  return {
    organic: params.organic,
    paid: params.paid,
    organicState,
    paidState,
    notices,
    daily,
    // Sin leads no hay costo por lead: una raya, no un cero.
    costPerLead: spend !== null && leads !== null && leads > 0 ? Number((spend / leads).toFixed(2)) : null,
  };
}

export interface ComparisonRow {
  label: string;
  organic: number | null;
  paid: number | null;
  /** Por que una de las dos no tiene numero. */
  note?: string;
}

/**
 * La comparacion lado a lado.
 *
 * Sin columna "total": el alcance organico y el pago se superponen y Meta
 * no dice cuanto. Un total seria un numero que no existe.
 */
export function comparison(view: UnifiedView): ComparisonRow[] {
  return [
    {
      label: "Alcance",
      organic: view.organic?.reach ?? null,
      paid: view.paid?.reach ?? null,
      note: "No se suman: la misma persona puede haber visto las dos cosas.",
    },
    { label: "Interacciones", organic: view.organic?.interactions ?? null, paid: view.paid?.clicks ?? null },
    {
      label: "Seguidores ganados",
      organic: view.organic?.followersGained ?? null,
      paid: null,
      note: "Los anuncios no informan seguidores ganados.",
    },
    {
      label: "Piezas publicadas",
      organic: view.organic?.posts ?? null,
      paid: null,
    },
    { label: "Gasto", organic: 0, paid: view.paid?.spend ?? null },
    { label: "Leads", organic: null, paid: view.paid?.leads ?? null },
  ];
}
