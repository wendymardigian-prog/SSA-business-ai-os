/**
 * Clasificacion de llamadas por reglas (sin IA). Funciones puras.
 *
 * Portado de prevxcrm (`call-classification.ts`). Cambios al portar:
 *  - `cliente_cx` pasa a `cliente` (el alcance de la v7 lo llama asi).
 *  - Los estados son los de la base de SSA (`pending`, `not_applicable`,
 *    `needs_review`), no los de prevxcrm en castellano.
 *  - La llamada vinculada a una agenda se llama `booking_id`.
 * La usan la ingesta, el handler `call_classify` y la pantalla de configuracion.
 */

export const BASE_CALL_TYPES = [
  'cierre', 'seguimiento', 'triaje', 'equipo', 'cliente', 'clase', 'no_show', 'otra',
] as const;
export type BaseCallType = (typeof BASE_CALL_TYPES)[number];

export type RuleCond =
  | 'duration_lt' | 'people_gte' | 'title_contains' | 'email_contains' | 'only_team' | 'has_appointment';

export interface ClassificationRule {
  id?: string;
  on?: boolean;
  cond: RuleCond | string;
  value?: unknown;
  type: string;
}

export interface Attendee { name?: string | null; email?: string | null; is_external?: boolean | null }
export interface Utterance { speaker?: { display_name?: string | null } | null; text?: string | null }

export interface MeetingForRules {
  title?: string | null;
  duration_seconds?: number | null;
  attendees?: unknown;
  transcript?: unknown;
  booking_id?: string | null;
}

export interface RuleResult { call_type: string; rule_label: string }

export function normalizeText(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTermList(text: string | null | undefined): string[] {
  return String(text ?? '').split(',').map((t) => t.trim()).filter((t) => t.length > 0);
}

function asAttendees(a: unknown): Attendee[] {
  return Array.isArray(a) ? (a.filter((x) => x && typeof x === 'object') as Attendee[]) : [];
}
function asUtterances(t: unknown): Utterance[] {
  return Array.isArray(t) ? (t.filter((x) => x && typeof x === 'object') as Utterance[]) : [];
}

export function speakerNames(transcript: unknown): string[] {
  const set = new Map<string, string>();
  for (const u of asUtterances(transcript)) {
    const n = u.speaker?.display_name;
    if (n && normalizeText(n)) set.set(normalizeText(n), n);
  }
  return [...set.values()];
}

export function countPeople(attendees: unknown, transcript: unknown) {
  const emails = new Set<string>();
  for (const a of asAttendees(attendees)) {
    const e = normalizeText(a.email);
    if (e) emails.add(e);
  }
  const participants = emails.size;
  const speakers = speakerNames(transcript).length;
  return { participants, speakers, people: Math.max(participants, speakers) };
}

function toTerms(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (typeof value === 'string') return parseTermList(value);
  return [];
}

function domainOf(email: string): string {
  const i = email.lastIndexOf('@');
  return i >= 0 ? email.slice(i + 1) : '';
}

export function applyClassificationRules(
  meeting: MeetingForRules,
  rules: ClassificationRule[] | null | undefined,
  teamEmails: string[] = [],
  teamNames: string[] = [],
): RuleResult | null {
  const list = Array.isArray(rules) ? rules : [];
  const { people } = countPeople(meeting.attendees, meeting.transcript);
  const title = normalizeText(meeting.title);
  const attendees = asAttendees(meeting.attendees);
  const teamEmailSet = new Set(teamEmails.map(normalizeText).filter(Boolean));
  const teamDomains = new Set([...teamEmailSet].map(domainOf).filter(Boolean));
  const teamNameSet = new Set(teamNames.map(normalizeText).filter(Boolean));

  for (const r of list) {
    if (!r || r.on === false || !r.type) continue;
    switch (r.cond) {
      case 'duration_lt': {
        const mins = Number(r.value) || 0;
        const secs = meeting.duration_seconds;
        if (secs != null && mins > 0 && secs < mins * 60) {
          return { call_type: r.type, rule_label: `menos de ${mins} min` };
        }
        break;
      }
      case 'people_gte': {
        const n = Number(r.value) || 0;
        if (n > 0 && people >= n) return { call_type: r.type, rule_label: `${people} participantes` };
        break;
      }
      case 'title_contains': {
        const hit = toTerms(r.value).find((t) => normalizeText(t) && title.includes(normalizeText(t)));
        if (hit) return { call_type: r.type, rule_label: `título contiene «${hit}»` };
        break;
      }
      case 'email_contains': {
        const emails = attendees.map((a) => normalizeText(a.email)).filter(Boolean);
        const hit = toTerms(r.value).find((t) => {
          const nt = normalizeText(t);
          return nt && emails.some((e) => e.includes(nt));
        });
        if (hit) return { call_type: r.type, rule_label: `email «${hit}»` };
        break;
      }
      case 'only_team': {
        const voices = speakerNames(meeting.transcript).map(normalizeText);
        // Con 1 o 2 invitados la evidencia es débil: Fathom solo lista a los
        // invitados del calendario, y un lead que entra por link no figura.
        // Se deja pasar a la siguiente regla (o a la IA).
        if (attendees.length <= 2 || voices.length === 0 || teamNameSet.size === 0) break;
        const allInternal = attendees.every((a) => {
          const e = normalizeText(a.email);
          if (!e) return false;
          if (a.is_external === true) return teamEmailSet.has(e);
          return teamEmailSet.has(e) || teamDomains.has(domainOf(e)) || a.is_external === false;
        });
        const allTeamVoices = voices.every((v) => teamNameSet.has(v));
        if (allInternal && allTeamVoices) return { call_type: r.type, rule_label: 'solo equipo' };
        break;
      }
      case 'has_appointment': {
        // `venta` fue una clave intermedia usada por la regla de cita. Una cita
        // vinculada identifica una llamada de cierre; el resultado se guarda aparte.
        if (meeting.booking_id) {
          return { call_type: r.type === 'venta' ? 'cierre' : r.type, rule_label: 'cita de ventas' };
        }
        break;
      }
      default:
        break;
    }
  }
  return null;
}

/** Nombres del equipo para comparar voces: nombre completo y "nombre apellido". */
export function teamNamesFrom(members: Array<{ full_name?: string | null; first_name?: string | null; last_name?: string | null }>): string[] {
  const out: string[] = [];
  for (const m of members) {
    if (m.full_name) out.push(m.full_name);
    const fl = [m.first_name, m.last_name].filter(Boolean).join(' ');
    if (fl) out.push(fl);
  }
  return out;
}

/**
 * Estado del analisis despues de clasificar. `auto` ya no cambia el estado: con
 * el modo automatico apagado la llamada queda `pending` con motivo `manual`
 * (F22); lo que distingue a los dos casos es el motivo, no el estado.
 * Acepta `venta` solo por compatibilidad historica.
 */
export function analysisStatusAfterClassify(
  callType: string,
  opts: { auto?: boolean; analyzeTypes: string[]; lowConfidence?: boolean },
): 'pending' | 'not_applicable' | 'needs_review' {
  if (opts.lowConfidence) return 'needs_review';
  const analizable = callType === 'venta' || opts.analyzeTypes.includes(callType);
  // Un tipo que no se analiza no tiene nada pendiente; uno que si, queda
  // `pending` (lo encola el modo automatico, o lo analiza una persona).
  return analizable ? 'pending' : 'not_applicable';
}

const OMITIDA = '\n[… parte central omitida …]\n';
/** Conserva principio y final; nunca corta el final. */
export function headAndTail(text: string, max: number, each: number): string {
  if (text.length <= max) return text;
  return text.slice(0, each) + OMITIDA + text.slice(text.length - each);
}
