/**
 * Mapa correo -> closer, para decidir quien grabo una llamada (F4).
 *
 * Portado de prevxcrm (`fathom-closers.ts`). Incluye el correo de la cuenta de
 * cada closer y sus correos alternos: un closer puede grabar en Fathom o Zoom
 * con un correo personal. Solo cuentan las personas marcadas "es closer".
 */

export const MAX_CLOSER_EMAILS = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Un correo normalizado (sin espacios, en minuscula), o null si no es un correo. */
export function normalizeFathomEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.replace(/\s+/g, "").toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

/** Los correos alternos validos y sin repetir de una lista cualquiera. */
export function cleanCloserEmails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const e = normalizeFathomEmail(x);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

export interface CloserCandidate {
  userId: string;
  /** El correo de la cuenta (auth.users). */
  email: string | null;
  isCloser: boolean;
  closerEmails: string[];
}

/** correo -> userId del closer. Solo las personas marcadas como closer. */
export function buildCloserByEmail(members: CloserCandidate[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of members) {
    if (!m.isCloser) continue;
    const own = normalizeFathomEmail(m.email);
    const emails = [...(own ? [own] : []), ...cleanCloserEmails(m.closerEmails)];
    for (const e of emails) if (!map.has(e)) map.set(e, m.userId);
  }
  return map;
}

/** Todos los correos de closers, para pedirle a Fathom solo sus llamadas (`recorded_by[]`). */
export function closerEmails(byEmail: Map<string, string>): string[] {
  return [...byEmail.keys()];
}

export type CloserEmailCheck = { ok: true; emails: string[] } | { ok: false; error: string };

/**
 * Valida los correos alternos que se quieren cargar para una persona: validos,
 * sin repetir, hasta 5, y que ninguno sea de OTRA persona (ni su correo de
 * cuenta ni uno de sus alternos). El error nombra a la otra persona.
 */
export function validateCloserEmails(
  userId: string,
  raw: unknown,
  others: Array<{ userId: string; name: string; email: string | null; closerEmails: string[] }>,
): CloserEmailCheck {
  const emails = cleanCloserEmails(raw);
  if (emails.length > MAX_CLOSER_EMAILS) {
    return { ok: false, error: `Podés cargar hasta ${MAX_CLOSER_EMAILS} correos alternos` };
  }
  for (const e of emails) {
    for (const o of others) {
      if (o.userId === userId) continue;
      const theirs = [normalizeFathomEmail(o.email), ...cleanCloserEmails(o.closerEmails)];
      if (theirs.includes(e)) return { ok: false, error: `${e} ya es un correo de ${o.name}` };
    }
  }
  return { ok: true, emails };
}
