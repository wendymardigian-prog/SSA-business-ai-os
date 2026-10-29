/**
 * El link de baja de un email de marketing (suscripcion a emails, E3).
 *
 * Todo email de MARKETING lleva:
 *  - un pie al final: "Recibís este email porque te registraste en {marca}.
 *    Darme de baja", mas la direccion postal del negocio si esta cargada;
 *  - las cabeceras `List-Unsubscribe` (el endpoint de baja en un clic) y
 *    `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), que Gmail y
 *    Yahoo exigen a quien manda en volumen.
 * Los transaccionales no llevan ni pie ni cabeceras.
 *
 * La variable `{{unsubscribe_url}}` deja poner el link donde se quiera. El token
 * recien se conoce al mandar (lo da la puerta, `canSendEmailTo`), y el limpiador
 * de HTML descarta un `href` que no sea https: por eso, ANTES de limpiar, la
 * variable se cambia por un marcador https (`UNSUBSCRIBE_PLACEHOLDER`) y al mandar
 * se reemplaza por el link real. Si la plantilla ya lo usa, no se suma el pie.
 *
 * Modulo puro (sin base ni red).
 */

import { escapeHtml } from "./html";

/** Un https que pasa el limpiador y que nunca va a existir (`.invalid` esta reservado). */
export const UNSUBSCRIBE_PLACEHOLDER = "https://baja.invalid/__unsubscribe__";

const VARIABLE = /\{\{\s*unsubscribe_url\s*\}\}/g;

/** La pagina publica de baja (la que ve la persona). */
export function unsubscribePageUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/baja/${encodeURIComponent(token)}`;
}

/** El endpoint de la baja en un clic (al que le hace POST el cliente de correo). */
export function oneClickUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/email/baja/${encodeURIComponent(token)}`;
}

/** Cambia `{{unsubscribe_url}}` por el marcador. Va antes de limpiar el HTML. */
export function protectUnsubscribeVariable(content: string): string {
  return content.replace(VARIABLE, UNSUBSCRIBE_PLACEHOLDER);
}

/** El cuerpo ya usa el link de baja (la variable o el marcador)? */
export function usesUnsubscribeLink(content: string): boolean {
  VARIABLE.lastIndex = 0;
  return content.includes(UNSUBSCRIBE_PLACEHOLDER) || VARIABLE.test(content);
}

/** Pone el link real donde estaba la variable o el marcador (sin link, queda vacio). */
export function resolveUnsubscribeLink(content: string, url: string | null): string {
  return content.split(UNSUBSCRIBE_PLACEHOLDER).join(url ?? "").replace(VARIABLE, url ?? "");
}

export interface FooterInput {
  brandName: string;
  /** La pagina de baja de esta persona. */
  url: string;
  /** La direccion postal del negocio (Ajustes → General → Marca). */
  postalAddress?: string | null;
}

const FOOTER_STYLE =
  "margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;";

/** El pie en HTML. Va DESPUES de limpiar el cuerpo (el limpiador descarta los estilos). */
export function marketingFooterHtml(input: FooterInput): string {
  const address = (input.postalAddress ?? "").trim();
  return (
    `<div style="${FOOTER_STYLE}">` +
    `<p style="margin:0;">Recibís este email porque te registraste en ${escapeHtml(input.brandName)}. ` +
    `<a href="${escapeHtml(input.url)}" style="color:#6b7280;text-decoration:underline;">Darme de baja</a></p>` +
    (address ? `<p style="margin:6px 0 0;">${escapeHtml(address)}</p>` : "") +
    `</div>`
  );
}

/** El pie en texto plano. */
export function marketingFooterText(input: FooterInput): string {
  const address = (input.postalAddress ?? "").trim();
  return `\n\n—\nRecibís este email porque te registraste en ${input.brandName}. Para darte de baja: ${input.url}${address ? `\n${address}` : ""}`;
}

/** Las cabeceras de baja (RFC 2369 + RFC 8058). Solo https: el mailto pide un buzon que reciba. */
export function unsubscribeHeaders(oneClick: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClick}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export interface MarketingExtras {
  html: string;
  headers: Record<string, string>;
}

/**
 * Lo que se le suma a un email al mandarlo. Marketing con token: el link real, el
 * pie (si la plantilla no lo usa ya) y las cabeceras. Transaccional: solo se
 * resuelve el link si alguien lo puso a mano; nada de pie ni cabeceras.
 */
export function withUnsubscribe(input: {
  html: string;
  category: "marketing" | "transactional";
  token: string | null;
  appUrl: string;
  brandName: string;
  postalAddress?: string | null;
}): MarketingExtras {
  const page = input.token ? unsubscribePageUrl(input.appUrl, input.token) : null;
  if (input.category !== "marketing" || !input.token || !page) {
    return { html: resolveUnsubscribeLink(input.html, page), headers: {} };
  }
  const alreadyLinked = usesUnsubscribeLink(input.html);
  const body = resolveUnsubscribeLink(input.html, page);
  const html = alreadyLinked ? body : body + marketingFooterHtml({ brandName: input.brandName, url: page, postalAddress: input.postalAddress });
  return { html, headers: unsubscribeHeaders(oneClickUrl(input.appUrl, input.token)) };
}
