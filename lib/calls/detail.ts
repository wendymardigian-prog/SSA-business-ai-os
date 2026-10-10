/**
 * Logica pura de la ficha de una llamada: lectura tolerante de `calls.analysis`,
 * metricas de conversacion calculadas desde la transcripcion y participantes.
 * Los numeros salen del codigo, nunca de la IA.
 *
 * Portado de prevxcrm (`meeting-detail.ts`). Cambio al portar: una
 * transcripcion SIN tiempos (importada) no inventa el minuto del precio ni el
 * monologo mas largo en segundos (`hasTimestamps`, F14).
 */

export interface TLine {
  speaker?: { display_name?: string; matched_calendar_invitee_email?: string | null };
  text?: string;
  timestamp?: string;
}
export interface Attendee { name?: string | null; email?: string | null; is_external?: boolean | null; matched_speaker_display_name?: string | null }

/** "HH:MM:SS" o "MM:SS" → segundos. */
export function tsToSeconds(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const parts = ts.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

const speakerName = (l: TLine) => (l.speaker?.display_name || '—').trim();

/** Duración de cada línea: hasta la siguiente; la última se estima por palabras (~2,5 palabras/seg). */
export function lineDurations(lines: TLine[], totalSeconds?: number | null): number[] {
  const starts = lines.map((l) => tsToSeconds(l.timestamp));
  return lines.map((l, i) => {
    const s = starts[i];
    const next = starts.slice(i + 1).find((x) => x !== null);
    const words = (l.text || '').split(/\s+/).filter(Boolean).length;
    if (s !== null && next !== undefined && next !== null && next >= s) return next - s;
    if (s !== null && i === lines.length - 1 && totalSeconds && totalSeconds > s) return Math.min(totalSeconds - s, Math.max(1, words / 2.5) * 3);
    return Math.max(1, words / 2.5);
  });
}

export interface SpeakerStat { name: string; seconds: number; pct: number; lines: number }

export function speakerStats(lines: TLine[], totalSeconds?: number | null): SpeakerStat[] {
  const d = lineDurations(lines, totalSeconds);
  const map = new Map<string, SpeakerStat>();
  lines.forEach((l, i) => {
    const n = speakerName(l);
    const s = map.get(n) ?? { name: n, seconds: 0, pct: 0, lines: 0 };
    s.seconds += d[i]; s.lines += 1;
    map.set(n, s);
  });
  const total = [...map.values()].reduce((a, s) => a + s.seconds, 0) || 1;
  return [...map.values()].map((s) => ({ ...s, pct: Math.round((s.seconds / total) * 100) })).sort((a, b) => b.seconds - a.seconds);
}

const PRICE_RE = /(\$\s?\d|\busd\b|d[oó]lares|\bprecio\b|inversi[oó]n (es|de|total)|\d+\s?mil\b|\bcuesta\b)/i;

/** Si la transcripcion trae tiempos. Una importada a mano puede no tenerlos. */
export function hasTimestamps(lines: TLine[]): boolean {
  return lines.some((l) => tsToSeconds(l.timestamp) !== null);
}

export interface ConversationMetrics {
  closerTalkPct: number | null;
  longestMonologueSec: number | null;
  questionsPerHour: number | null;
  priceMinute: number | null;
  /** false = la transcripcion no tiene tiempos: la vista explica por que faltan metricas. */
  timesAvailable: boolean;
}

/** Métricas del closer. `isCloser` decide qué hablante es el closer. */
export function conversationMetrics(lines: TLine[], isCloser: (name: string, l: TLine) => boolean, totalSeconds?: number | null): ConversationMetrics {
  if (lines.length === 0) return { closerTalkPct: null, longestMonologueSec: null, questionsPerHour: null, priceMinute: null, timesAvailable: false };
  const timesAvailable = hasTimestamps(lines);
  const d = lineDurations(lines, totalSeconds);
  let closerSec = 0, all = 0, run = 0, longest = 0, questions = 0;
  let price: number | null = null;
  lines.forEach((l, i) => {
    const c = isCloser(speakerName(l), l);
    all += d[i];
    if (c) {
      closerSec += d[i];
      run += d[i];
      longest = Math.max(longest, run);
      questions += ((l.text || '').match(/\?/g) || []).length;
      if (price === null && PRICE_RE.test(l.text || '')) {
        const s = tsToSeconds(l.timestamp);
        if (s !== null) price = Math.floor(s / 60);
      }
    } else run = 0;
  });
  // Sin tiempos, las duraciones son una estimacion por palabras: sirve para el
  // reparto de la charla, no para decir "el minuto 4" ni "180 segundos".
  const hours = (totalSeconds && totalSeconds > 0 ? totalSeconds : timesAvailable ? all : 0) / 3600;
  return {
    closerTalkPct: all > 0 ? Math.round((closerSec / all) * 100) : null,
    longestMonologueSec: timesAvailable ? Math.round(longest) : null,
    questionsPerHour: hours > 0 ? Math.round(questions / hours) : null,
    priceMinute: timesAvailable ? price : null,
    timesAvailable,
  };
}

export type ParticipantRole = 'closer' | 'lead' | 'equipo';
export interface Participant {
  name: string; email: string | null; role: ParticipantRole; external: boolean | null;
  spoke: boolean; minutes: number; pct: number;
}

/** Une invitados del calendario con quienes hablaron en la transcripción. */
export function buildParticipants(attendees: Attendee[], lines: TLine[], hostEmail: string | null, totalSeconds?: number | null) {
  const stats = speakerStats(lines, totalSeconds);
  const byName = new Map(stats.map((s) => [s.name.toLowerCase(), s]));
  const emailBySpeaker = new Map<string, string>();
  for (const l of lines) {
    const e = l.speaker?.matched_calendar_invitee_email;
    if (e) emailBySpeaker.set(speakerName(l).toLowerCase(), e.toLowerCase());
  }
  const host = (hostEmail || '').toLowerCase();
  const out: Participant[] = [];
  const used = new Set<string>();
  const roleOf = (email: string | null, external: boolean | null): ParticipantRole =>
    email && email === host ? 'closer' : external ? 'lead' : 'equipo';

  for (const a of attendees) {
    const email = a.email ? a.email.toLowerCase() : null;
    const spk = a.matched_speaker_display_name
      || [...emailBySpeaker.entries()].find(([, e]) => e === email)?.[0] || a.name || '';
    const st = byName.get(spk.toLowerCase());
    if (st) used.add(st.name.toLowerCase());
    out.push({
      name: a.name || spk || email || 'Sin nombre', email, external: a.is_external ?? null,
      role: roleOf(email, a.is_external ?? null), spoke: !!st, minutes: st ? Math.round(st.seconds / 60) : 0, pct: st?.pct ?? 0,
    });
  }
  for (const s of stats) {
    if (used.has(s.name.toLowerCase())) continue;
    const email = emailBySpeaker.get(s.name.toLowerCase()) ?? null;
    out.push({ name: s.name, email, external: null, role: roleOf(email, null), spoke: true, minutes: Math.round(s.seconds / 60), pct: s.pct });
  }
  return {
    invited: attendees.length,
    spoke: stats.length,
    participants: out.sort((a, b) => b.pct - a.pct),
  };
}

/* ─── Lectura tolerante del análisis vigente ─── */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null);
export const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
export const obj = (v: unknown): Obj => (isObj(v) ? v : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const strList = (v: unknown): string[] => arr(v).map((x) => (typeof x === 'string' ? x : str(obj(x).texto) ?? str(obj(x).label) ?? '')).filter(Boolean);

export interface RubricItem { code: string; name: string; score: number | null; justification: string | null; quote: string | null; timestamp: string | null }
export interface Belief { name: string; state: string | null; evidence: string | null; unexplored: boolean }
export interface AlertItem { index: number; type: string; text: string | null; resolved: boolean }

export function readAnalysis(a: unknown) {
  const A = obj(a);
  const res = obj(A.resultado);
  const q = obj(A.momento_quiebre);
  const pain = obj(A.dolor);
  const desire = obj(A.deseo);
  const ob = obj(A.objecion);
  const fb = obj(A.feedback);
  const lead = obj(A.lead);
  const alerts: AlertItem[] = arr(A.alertas).map((x, i) => {
    const o = obj(x);
    return { index: i, type: str(o.tipo) ?? (typeof x === 'string' ? x : 'alerta'), text: str(o.texto) ?? str(o.detalle), resolved: o.resuelta === true };
  });
  const rubric: RubricItem[] = arr(A.rubrica).map((x, i) => {
    const o = obj(x);
    return { code: str(o.codigo) ?? String(i), name: str(o.nombre) ?? str(o.codigo) ?? `Criterio ${i + 1}`, score: num(o.puntaje), justification: str(o.justificacion), quote: str(o.cita), timestamp: str(o.timestamp) };
  });
  const beliefs: Belief[] = arr(lead.creencias).map((x, i) => {
    const o = obj(x);
    const state = str(o.estado);
    return { name: str(o.nombre) ?? `Creencia ${i + 1}`, state, evidence: str(o.evidencia) ?? str(o.cita), unexplored: !state || /no.?explorad/i.test(state) };
  });
  const quotes = [
    ...rubric.map((r) => r.quote), str(q.cita), str(pain.cita), str(ob.cita),
    ...arr(A.citas).map((c) => str(obj(c).texto) ?? str(c)),
  ].filter((x): x is string => !!x);
  const verified = obj(A.citas_verificadas);
  return {
    empty: Object.keys(A).length === 0,
    result: { category: str(res.categoria) ?? str(A.outcome), date: str(res.fecha), nextStep: str(res.proximo_paso), scheduledInCall: bool(res.agendada_en_llamada) },
    breakpoint: { text: str(q.descripcion) ?? str(q.texto), suggested: str(q.frase_sugerida), timestamp: str(q.timestamp) },
    pain: { category: str(pain.categoria), proposed: pain.propuesta === true, text: str(pain.texto) ?? str(A.dolor_principal), depth: str(pain.profundidad), timestamp: str(pain.timestamp) },
    desire: { category: str(desire.categoria), proposed: desire.propuesta === true, text: str(desire.texto) ?? str(A.deseo_principal), timestamp: str(desire.timestamp) },
    objection: { category: str(ob.categoria), proposed: ob.propuesta === true, said: str(ob.dijo) ?? str(A.objecion_principal), underlying: str(ob.de_fondo), answered: bool(ob.respondida), resolved: bool(ob.resuelta), timestamp: str(ob.timestamp) },
    summary: str(A.resumen),
    temperature: num(A.temperatura),
    alerts,
    rubric,
    feedback: {
      focus: str(fb.foco),
      worked: strList(fb.funciono),
      improve: arr(fb.mejorar).map((x) => ({ text: typeof x === 'string' ? x : str(obj(x).texto) ?? '', suggested: str(obj(x).frase_sugerida) })).filter((x) => x.text),
    },
    lead: {
      profile: str(lead.perfil),
      pains: strList(lead.dolores), desires: strList(lead.deseos), objections: strList(lead.objeciones),
      trigger: str(lead.detonante), previous: str(lead.intentos_previos), decider: str(lead.decisor) ?? str(lead.quien_decide), source: str(lead.como_llego),
      tolerance: str(lead.tolerancia),
      beliefs,
    },
    quotes,
    verifiedQuotes: { ok: num(verified.ok), total: num(verified.total) },
    setter: str(A.setter),
  };
}
export type ReadAnalysis = ReturnType<typeof readAnalysis>;

/** Una línea de la transcripción está citada si contiene (o está contenida en) alguna cita de la IA. */
export function isQuotedLine(text: string | undefined, quotes: string[]): boolean {
  if (!text || quotes.length === 0) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  const t = norm(text);
  if (t.length < 8) return false;
  return quotes.some((q) => {
    const n = norm(q);
    return n.length >= 8 && (t.includes(n) || n.includes(t));
  });
}

/** En filtros y agrupaciones, una categoría propuesta por la IA cuenta como «otra» hasta resolverse. */
export function effectiveCategory(c: { category: string | null; proposed: boolean }): string | null {
  return c.proposed ? 'otra' : c.category;
}
