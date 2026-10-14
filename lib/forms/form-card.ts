/**
 * Lo que dice cada tarjeta de la lista de formularios (plano formularios-ui, F6). Puro: el componente solo
 * lo dibuja. Nada se inventa: un dato que la app no calcula (sin vistas, sin respuestas) no aparece.
 */
import { FORM_STATUS_LABELS, FORM_TYPE_LABELS, type FormStatus, type FormType } from "./fields";
import { formatPercent } from "./metrics";
import type { FormListRow } from "./list";

export interface FormCardView {
  id: string;
  /** Toda la tarjeta es un link real al editor. */
  href: string;
  name: string;
  type: FormType;
  typeLabel: string;
  status: FormStatus;
  statusLabel: string;
  /** "Lo que ve el público: …" solo si el título público es distinto del nombre interno. */
  publicLine: { kind: "different"; prefix: string; title: string } | { kind: "same"; text: string };
  stats:
    | { kind: "none"; text: string }
    | {
        kind: "live";
        /** El número grande ("1.874"). */
        big: string;
        /** "respuestas", "firmas" o "reportes". */
        unit: string;
        /** Al costado: la conversión, el NPS, el promedio o las personas. Null si la app no lo calcula. */
        side: string | null;
        /** 0 a 100: las respuestas de este formulario contra las del que más tiene. Null en un reporte de fin de día. */
        barPct: number | null;
      };
  footerLeft: string;
  footerRight: string;
  archived: boolean;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

function localParts(date: Date, timeZone: string): { y: number; m: number; d: number; hh: string; mm: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hh: get("hour"), mm: get("minute") };
}

const dayNumber = (p: { y: number; m: number; d: number }) => Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000);

/** "hoy 09:41", "ayer 18:20", "5 oct" o "12 mar 2025": en la zona de quien mira. */
export function whenLabel(iso: string, now: Date, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const a = localParts(at, timeZone);
  const n = localParts(now, timeZone);
  const diff = dayNumber(n) - dayNumber(a);
  if (diff === 0) return `hoy ${a.hh}:${a.mm}`;
  if (diff === 1) return `ayer ${a.hh}:${a.mm}`;
  return `${a.d} ${MONTHS[a.m - 1]}${a.y !== n.y ? ` ${a.y}` : ""}`;
}

/** "hace 5 min", "hace 2 h" o, pasado el dia, la fecha ("5 oct"). */
export function editedLabel(iso: string, now: Date, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 24 * 60) return `hace ${Math.floor(minutes / 60)} h`;
  return whenLabel(iso, now, timeZone);
}

const UNIT: Record<FormType, [string, string]> = {
  custom: ["respuesta", "respuestas"],
  survey: ["respuesta", "respuestas"],
  contract: ["firma", "firmas"],
  eod: ["reporte", "reportes"],
};

const plural = (n: number, [one, many]: [string, string]) => (n === 1 ? one : many);

/** El NPS con su signo ("+62", "-10", "0"). */
export function formatNps(nps: number): string {
  return nps > 0 ? `+${nps}` : String(nps);
}

export function formCardView(
  row: FormListRow,
  options: { now?: Date; timeZone?: string; maxSubmissions?: number } = {},
): FormCardView {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? "UTC";
  const max = options.maxSubmissions ?? row.submissions;
  const different = row.publicTitle !== null && row.publicTitle !== row.name;

  let stats: FormCardView["stats"];
  if (row.submissions > 0) {
    let side: string | null = null;
    if (row.type === "eod") side = row.people !== null ? `${row.people} ${row.people === 1 ? "persona" : "personas"}` : null;
    else if (row.type === "survey") {
      if (row.nps !== null) side = `NPS ${formatNps(row.nps)}`;
      else if (row.average !== null) side = `★ ${String(row.average).replace(".", ",")}`;
    } else if (row.conversion !== null) side = `${formatPercent(row.conversion)} conversión`;
    stats = {
      kind: "live",
      big: row.submissions.toLocaleString("es-AR"),
      unit: plural(row.submissions, UNIT[row.type]),
      side,
      barPct: row.type === "eod" || max <= 0 ? null : Math.max(2, Math.min(100, Math.round((row.submissions / max) * 100))),
    };
  } else {
    stats = { kind: "none", text: row.status === "draft" ? "Sin publicar todavía" : "Sin respuestas" };
  }

  const questions = `${row.questionCount} ${row.questionCount === 1 ? "pregunta" : "preguntas"}`;
  const last = row.lastSubmissionAt ? whenLabel(row.lastSubmissionAt, now, timeZone) : "";
  return {
    id: row.id,
    href: `/dashboard/formularios/${row.id}`,
    name: row.name,
    type: row.type,
    typeLabel: FORM_TYPE_LABELS[row.type],
    status: row.status,
    statusLabel: FORM_STATUS_LABELS[row.status],
    publicLine: different
      ? { kind: "different", prefix: "Lo que ve el público: ", title: row.publicTitle as string }
      : { kind: "same", text: "El título público es el mismo" },
    stats,
    footerLeft: last ? `${questions} · última ${last}` : questions,
    footerRight: `Editado ${editedLabel(row.updatedAt, now, timeZone)}`,
    archived: row.status === "archived",
  };
}
