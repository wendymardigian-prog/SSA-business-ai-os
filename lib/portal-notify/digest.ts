// @plantilla-quitar(servicios)
/**
 * El resumen semanal por email del estudiante (F128), puro: qué secciones lleva (solo las que tienen algo; Mis
 * referidos siempre al final, con `weeklyDigestView`), el HTML y cuándo sale (lunes 8:00 en SU zona).
 */
import { weeklyDigestView, type DigestSection } from "./weeklyDigestView";

/** Lo que devuelve `app_servicio.portal_digest_data`: un número por sección (0 = no sale). */
export interface DigestCounts {
  done: number;
  pending: number;
  challenge: number;
  content: number;
  community: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const REFERRALS_TEXT = "Compartí tu link de referidos desde el portal: cada persona que se suma por vos queda a tu nombre.";

export function digestSections(c: DigestCounts): DigestSection[] {
  return weeklyDigestView(
    [
      { key: "done", text: c.done > 0 ? `Completaste ${plural(c.done, "paso", "pasos")} esta semana.` : null },
      { key: "pending", text: c.pending > 0 ? `Tenés ${plural(c.pending, "cosa", "cosas")} para esta semana.` : null },
      { key: "challenge", text: c.challenge > 0 ? `Cargaste ${plural(c.challenge, "reporte", "reportes")} del reto.` : null },
      { key: "content", text: c.content > 0 ? `Hay ${plural(c.content, "clase nueva", "clases nuevas")} para ver.` : null },
      { key: "community", text: c.community > 0 ? `${plural(c.community, "publicación nueva", "publicaciones nuevas")} en la comunidad.` : null },
    ],
    REFERRALS_TEXT,
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function digestSubject(programName: string): string {
  return `Tu semana en ${programName}`;
}

/** El cuerpo del email. El link para apagarlo lo suma el envío (es transaccional y respeta la preferencia de Perfil). */
export function digestHtml(name: string | null, programName: string, sections: DigestSection[]): string {
  const hi = name ? `Hola, ${esc(name.split(" ")[0])}` : "Hola";
  return [
    `<p>${hi}:</p>`,
    `<p>Esto es lo de tu semana en <b>${esc(programName)}</b>.</p>`,
    ...sections.map((s) => `<h3 style="margin:16px 0 4px">${esc(s.title)}</h3><p style="margin:0">${esc(s.text)}</p>`),
    `<p style="margin-top:24px;color:#666;font-size:12px">Te llega los lunes. Lo podés apagar desde tu Perfil, en Notificaciones.</p>`,
  ].join("\n");
}

/** El día de la semana de una fecha civil (0 = domingo, 1 = lunes). */
export function weekday(localDate: string): number {
  return new Date(`${localDate}T12:00:00Z`).getUTCDay();
}

/** El instante (ISO, UTC) de las `hour`:00 de `localDate` en la zona `timeZone`. */
export function localTimeToUtc(localDate: string, hour: number, timeZone: string): string {
  const guess = Date.parse(`${localDate}T${String(hour).padStart(2, "0")}:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess))
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  const asLocal = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  return new Date(guess - (asLocal - guess)).toISOString();
}
