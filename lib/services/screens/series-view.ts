// @plantilla-quitar(servicios)
/**
 * La serie de cada paso que se repite, para la ficha del servicio (00522). PURO: el componente solo compone.
 *
 * Por paso: la regla en palabras, cuántas vueltas hubo y cuántas se cumplieron, la última y la próxima (cuando se puede
 * saber sin la base: con días de la semana cada N semanas, la próxima la sabe solo el motor y no se muestra), y si la
 * serie terminó y por qué.
 */
import { addDays, nextOccurrence, type Recurrence } from "../engine-rules";
import { describeRepetition, SERIES_END_LABEL } from "../repetition";

export interface SeriesTemplateRow {
  id: string;
  phase_id: string;
  name: string;
  recurrence: unknown;
  series_ended_at: string | null;
  series_end_reason: string | null;
}
export interface SeriesRoundRow {
  parent_item_id: string | null;
  status: string;
  occurrence_index: number | null;
  round_on: string | null;
  due_on: string | null;
}

export interface SeriesView {
  id: string;
  phaseId: string;
  name: string;
  rule: string;
  rounds: number;
  done: number;
  lastOn: string | null;
  nextOn: string | null;
  ended: boolean;
  endedLabel: string | null;
  recurrence: Record<string, unknown> | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function seriesView(templates: SeriesTemplateRow[], rounds: SeriesRoundRow[], phaseOpen: (phaseId: string) => boolean): SeriesView[] {
  return templates.map((t) => {
    const own = rounds.filter((r) => r.parent_item_id === t.id).sort((a, b) => (a.occurrence_index ?? 0) - (b.occurrence_index ?? 0));
    const first = own[0];
    const last = own[own.length - 1];
    const r = isObj(t.recurrence) ? (t.recurrence as unknown as Recurrence) : null;
    const ended = !!t.series_ended_at;
    const firstOn = first?.round_on ?? null;
    const lastOn = last?.round_on ?? null;
    // La próxima sale de la regla, contando desde la primera vuelta. Con días de la semana cada N semanas, el
    // conteo de semanas depende del día en que empezó la serie (que la base no guarda): no se adivina.
    const unsure = !!r && r.every === "n_weeks" && Array.isArray(r.weekdays) && r.weekdays.length > 0;
    const nextOn = !ended && r && firstOn && lastOn && phaseOpen(t.phase_id) && !unsure ? nextOccurrence(r, firstOn, addDays(lastOn, 1)) : null;
    return {
      id: t.id,
      phaseId: t.phase_id,
      name: t.name,
      rule: describeRepetition(t.recurrence),
      rounds: own.length,
      done: own.filter((x) => x.status === "completed").length,
      lastOn,
      nextOn,
      ended,
      endedLabel: ended ? (SERIES_END_LABEL[t.series_end_reason ?? ""] ?? "Terminó") : null,
      recurrence: isObj(t.recurrence) ? t.recurrence : null,
    };
  });
}
