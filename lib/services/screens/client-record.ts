// @plantilla-quitar(servicios)
/**
 * La linea compacta de la cabecera de la ficha del cliente (Servicios A2, F130.2): total cobrado, portal (estado y
 * cuando entro), ultimo contacto, cliente desde y lead desde. Sin tarjetas de cifras. Puro. Lo que no se sabe, no sale.
 */

export interface ClientFactsInput {
  paidCents: number | null;
  hasPortal: boolean;
  portal: { accountStatus: string | null; lastLoginAt: string | null } | null;
  lastContact: string | null;
  clientSince: string | null;
  leadSince: string | null;
}

export interface ClientFact {
  label: string;
  value: string;
  tone?: "warn" | "bad";
}

const civil = new Intl.DateTimeFormat("es", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** «hace 2 h», «hoy», «ayer», «hace 5 días» o la fecha, desde un instante (en la zona de quien mira). */
export function relativeWhen(iso: string, nowIso: string, timeZone: string): string {
  const ms = Date.parse(nowIso) - Date.parse(iso);
  if (ms < 60 * 60_000) return "hace un rato";
  if (ms < 24 * 3_600_000) return `hace ${Math.floor(ms / 3_600_000)} h`;
  const day = (v: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v));
  const days = Math.round((Date.parse(`${day(nowIso)}T00:00:00Z`) - Date.parse(`${day(iso)}T00:00:00Z`)) / 86_400_000);
  if (days <= 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  return new Intl.DateTimeFormat("es", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

const PORTAL_STATUS: Record<string, string> = { active: "Activo", invited: "Invitado", suspended: "Suspendido" };

export function clientRecordFacts(i: ClientFactsInput, nowIso: string, timeZone: string): ClientFact[] {
  const out: ClientFact[] = [];
  if (i.paidCents !== null) out.push({ label: "Total cobrado", value: `US$${(i.paidCents / 100).toLocaleString("es-AR", { maximumFractionDigits: i.paidCents % 100 ? 2 : 0 })}` });
  if (i.hasPortal) {
    const st = i.portal?.accountStatus ?? null;
    if (!st) out.push({ label: "Portal", value: "Sin invitar" });
    else if (i.portal?.lastLoginAt) {
      const stale = Date.parse(nowIso) - Date.parse(i.portal.lastLoginAt) > 7 * 86_400_000;
      out.push({ label: "Portal", value: `${PORTAL_STATUS[st] ?? st} · entró ${relativeWhen(i.portal.lastLoginAt, nowIso, timeZone)}`, tone: stale ? "bad" : undefined });
    } else out.push({ label: "Portal", value: `${PORTAL_STATUS[st] ?? st} · nunca entró`, tone: "warn" });
  }
  if (i.lastContact) out.push({ label: "Último contacto", value: relativeWhen(i.lastContact, nowIso, timeZone) });
  if (i.clientSince) out.push({ label: "Cliente desde", value: civil.format(new Date(`${i.clientSince.slice(0, 10)}T12:00:00Z`)) });
  if (i.leadSince) out.push({ label: "Lead desde", value: new Intl.DateTimeFormat("es", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(i.leadSince)) });
  return out;
}
