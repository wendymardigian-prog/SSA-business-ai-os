/**
 * Los correos con los que una persona graba en Fathom, para saber que llamadas
 * son suyas (F4). Puro.
 *
 * Entra lo que grabo quien conecto su Fathom: con el correo de su cuenta del
 * sistema, con el de su cuenta de Fathom si se conoce (`/users/me` no esta en la
 * documentacion de Fathom y puede no contestar) o con uno de los que ella misma
 * cargo en Mi Fathom. Quien lo puede usar lo decide el rol (`calls.view`), no una
 * marca aparte. Lo que le comparten a la persona en Fathom no entra.
 */

export const MAX_RECORDER_EMAILS = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Un correo normalizado (sin espacios, en minuscula), o null si no es un correo. */
export function normalizeFathomEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.replace(/\s+/g, "").toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

/** Los correos validos y sin repetir de una lista cualquiera. */
export function cleanRecorderEmails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const e = normalizeFathomEmail(x);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

export interface RecorderCandidate {
  userId: string;
  /** El correo de la cuenta (auth.users). */
  email: string | null;
  /** Los otros correos que cargo en Mi Fathom (`workspace_members.closer_emails`). */
  extraEmails: string[];
}

/** Con que correos entran las grabaciones de esta persona. `accountLabel` es la etiqueta de su conexion de Fathom. */
export function recorderEmailsFor(candidate: RecorderCandidate, accountLabel?: string | null): string[] {
  return cleanRecorderEmails([candidate.email, accountLabel, ...candidate.extraEmails]);
}

/** Los correos de todo el equipo: una persona con uno de estos en la reunion no es el lead. */
export function teamEmailsOf(candidates: RecorderCandidate[]): string[] {
  return cleanRecorderEmails(candidates.flatMap((c) => [c.email, ...c.extraEmails]));
}

export type RecorderEmailCheck = { ok: true; emails: string[] } | { ok: false; error: string };

/**
 * Valida los correos que una persona quiere cargar: validos, sin repetir, hasta 5 y
 * que ninguno sea de OTRA persona. El error no dice de quien es: lo ve cualquiera del
 * equipo que escriba un correo, y no tiene por que saberlo.
 */
export function validateRecorderEmails(userId: string, raw: unknown, candidates: RecorderCandidate[]): RecorderEmailCheck {
  const emails = cleanRecorderEmails(raw);
  if (emails.length > MAX_RECORDER_EMAILS) {
    return { ok: false, error: `Podés cargar hasta ${MAX_RECORDER_EMAILS} correos` };
  }
  const others = new Set(teamEmailsOf(candidates.filter((c) => c.userId !== userId)));
  const taken = emails.find((e) => others.has(e));
  if (taken) return { ok: false, error: `${taken} ya es de otra persona del equipo` };
  return { ok: true, emails };
}
