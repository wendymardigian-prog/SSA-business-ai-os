/**
 * Plantillas de los emails del sistema (invitaciones, avisos al equipo...).
 *
 * Todos van con la marca del negocio que los manda (`resolveBrand(workspace)`,
 * lib/brand.ts; lo que el negocio no tenga sale de la instalacion): su logo
 * arriba (o su inicial en un cuadrado de su color), una franja de su color y el
 * boton de su color.
 *
 * HTML de email "a la antigua" a proposito: tablas, estilos en linea y una
 * sola columna, porque los clientes de correo rompen casi todo el CSS moderno
 * (Outlook no entiende variables CSS ni `color-mix`). Por eso los colores se
 * resuelven aca, en hex, en el momento de armar el HTML.
 *
 * Legibilidad: el texto del boton y la inicial van claros sobre un color
 * oscuro y oscuros sobre uno claro (`readableTextOn`); lo que usa el color como
 * texto sobre blanco (el link, la etiqueta de arriba) se oscurece hasta leerse
 * (`readableInkOnWhite`). Un negocio puede elegir un amarillo patito y el email
 * se sigue leyendo.
 *
 * El logo es una imagen remota (el bucket publico `brand-assets`): si el
 * cliente de correo bloquea imagenes, se ve su texto alternativo (el nombre
 * del negocio), y el nombre va escrito abajo igual.
 */

import { dropDanglingComma, finalizeEmailHtml, interpolateHtml, isHtmlTemplate, preheaderHtml } from "./html";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { legacyNameToVariable, portalTextValues } from "@/lib/portal-admin/invite-variables"; // @plantilla-quitar(servicios)
import { mixHex, readableInkOnWhite, readableTextOn, resolveBrand, safeBrandColor, contrastRatio, type Brand } from "@/lib/brand";

interface EmailContent {
  subject: string;
  html: string;
}

/** Sin color de marca (ni del negocio ni de la instalacion), un gris casi negro. */
const NEUTRAL_COLOR = "#111827";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Los colores del email, todos en hex y ya pensados para que se lean. */
interface EmailTheme {
  /** El color de marca (franja, boton, monograma). */
  color: string;
  /** El texto que va encima del color (boton, inicial). */
  onColor: string;
  /** El color de marca como texto sobre blanco (links, etiqueta de arriba). */
  ink: string;
  /** Un fondo muy suave del color (la caja del rol). */
  tint: string;
  /** El borde de esa caja. */
  tintBorder: string;
  /** Un borde para el boton cuando el color casi no se distingue del blanco. */
  buttonBorder: string | null;
}

export function emailTheme(brand: Brand): EmailTheme {
  const color = safeBrandColor(brand.colorHex) ?? NEUTRAL_COLOR;
  const tooPale = contrastRatio(color, "#ffffff") < 1.6;
  return {
    color,
    onColor: readableTextOn(color),
    ink: readableInkOnWhite(color),
    tint: mixHex(color, "#ffffff", 0.9),
    tintBorder: mixHex(color, "#ffffff", 0.7),
    buttonBorder: tooPale ? mixHex(color, "#000000", 0.25) : null,
  };
}

/** El logo del negocio, o su inicial en un cuadrado de su color. */
function brandHeader(brand: Brand, theme: EmailTheme): string {
  const name = escapeHtml(brand.name);
  const mark = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="56" style="display:block;margin:0 auto;height:56px;width:auto;max-width:220px;border:0;outline:none;text-decoration:none;border-radius:12px;" />`
    : `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;border-collapse:separate;">
          <tr>
            <td width="56" height="56" align="center" valign="middle" bgcolor="${theme.color}" style="width:56px;height:56px;border-radius:14px;background:${theme.color};color:${theme.onColor};font-size:26px;font-weight:700;line-height:56px;text-align:center;${theme.buttonBorder ? `border:1px solid ${theme.buttonBorder};` : ""}">${escapeHtml(brand.initial)}</td>
          </tr>
        </table>`;
  return `${mark}
        <p style="margin:12px 0 0;font-size:14px;font-weight:600;color:#374151;letter-spacing:0.01em;">${name}</p>`;
}

/**
 * El marco comun de los emails del sistema: todo el cuerpo entra aca.
 * `preheader` es la linea que muestra la bandeja de entrada al lado del asunto.
 */
export function brandedEmailHtml(params: { brand?: Brand | null; body: string; preheader?: string; footerNote?: string }): string {
  const brand = params.brand ?? resolveBrand(null);
  const theme = emailTheme(brand);
  const preheader = params.preheader ? preheaderHtml(params.preheader) : "";
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;-webkit-font-smoothing:antialiased;">
    ${preheader}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6" style="background:#f3f4f6;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;border-collapse:separate;overflow:hidden;">
            <tr>
              <td height="6" bgcolor="${theme.color}" style="height:6px;line-height:6px;font-size:0;background:${theme.color};">&nbsp;</td>
            </tr>
            <tr>
              <td align="center" style="padding:32px 40px 8px;text-align:center;">
                ${brandHeader(brand, theme)}
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px;">
                <div style="height:1px;line-height:1px;font-size:0;background:#f0f1f3;margin:16px 0 0;">&nbsp;</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 40px 36px;font-size:15px;line-height:1.6;color:#111827;">
                ${params.body}
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
            <tr>
              <td align="center" style="padding:20px 24px 0;font-size:12px;line-height:1.6;color:#9ca3af;text-align:center;">
                ${params.footerNote ? `${params.footerNote}<br />` : ""}Enviado por ${escapeHtml(brand.name)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Un boton del color de marca, con el texto que se lee sobre ese color, y el link por si no anda. */
function button(url: string, label: string, theme: EmailTheme): string {
  const href = escapeHtml(url);
  const border = theme.buttonBorder ? `border:1px solid ${theme.buttonBorder};` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 0;border-collapse:separate;">
      <tr>
        <td align="center" bgcolor="${theme.color}" style="border-radius:10px;background:${theme.color};${border}">
          <a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;line-height:1.2;color:${theme.onColor};text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>
    <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
      ¿El botón no funciona? Copiá y pegá este link en tu navegador:<br />
      <a href="${href}" target="_blank" style="color:${theme.ink};word-break:break-all;">${href}</a>
    </p>`;
}

function eyebrow(text: string, theme: EmailTheme): string {
  return `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${theme.ink};">${escapeHtml(text)}</p>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;color:#111827;">${text}</h1>`;
}

/** Invitacion a sumarse al workspace. */
export function teamInviteEmail(params: {
  workspaceName: string;
  inviteUrl: string;
  roleLabel: string;
  /** Quien invita (su nombre o su email). Sin él, el texto no lo nombra. */
  inviterName?: string | null;
  /** La marca del negocio que invita (00266). Sin ella, la de la instalación. */
  brand?: Brand | null;
}): EmailContent {
  const brand = params.brand ?? resolveBrand(null);
  const theme = emailTheme(brand);
  const workspace = escapeHtml(params.workspaceName);
  const inviter = params.inviterName?.trim();
  const intro = inviter
    ? `<strong>${escapeHtml(inviter)}</strong> te invitó a sumarte al equipo de <strong>${workspace}</strong>.`
    : `Te invitaron a sumarte al equipo de <strong>${workspace}</strong>.`;
  return {
    subject: `Te invitaron a ${params.workspaceName}`,
    html: brandedEmailHtml({
      brand,
      preheader: `${inviter ? `${inviter} te invitó` : "Te invitaron"} a sumarte a ${params.workspaceName}. El link vence en 7 días.`,
      body: `
                ${eyebrow("Invitación", theme)}
                ${heading(`Te invitaron a sumarte a ${workspace}`)}
                <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;border-collapse:separate;">
                  <tr>
                    <td bgcolor="${theme.tint}" style="background:${theme.tint};border:1px solid ${theme.tintBorder};border-radius:12px;padding:14px 18px;">
                      <p style="margin:0;font-size:12px;color:#6b7280;">Vas a entrar con el rol</p>
                      <p style="margin:2px 0 0;font-size:16px;font-weight:700;color:#111827;">${escapeHtml(params.roleLabel)}</p>
                    </td>
                  </tr>
                </table>
                ${button(params.inviteUrl, "Aceptar la invitación", theme)}
                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
                  El link vence en 7 días. Si no esperabas esta invitación, podés ignorar este email.
                </p>`,
    }),
  };
}

// @plantilla-desde(servicios)
/**
 * La invitación al portal (Servicios A1, F41): el asunto y el texto salen de Ajustes del portal (si están vacíos, los
 * de siempre). El texto de la persona se escapa: nunca entra HTML de afuera. `{nombre}` se cambia por el nombre del
 * estudiante. El link vence en 7 días y se canjea recién al tocar el botón.
 */
export function portalInviteEmail(params: { workspaceName: string; inviteUrl: string; studentName?: string | null; subject?: string | null; body?: string | null; brand?: Brand | null }): EmailContent {
  const brand = params.brand ?? resolveBrand(null);
  const theme = emailTheme(brand);
  const name = params.studentName?.trim().split(/\s+/)[0] ?? "";
  const values = portalTextValues({ workspaceName: params.workspaceName, studentName: params.studentName });
  // `{nombre}` (la forma vieja) sale igual que siempre; las variables `{{…}}`, por la misma regla que los flujos.
  const fill = (t: string) => {
    const legacy = t.replace(/\{nombre\}/g, name);
    return (legacy.includes("{{") ? interpolateVariables(legacy, values) : legacy).replace(/\s+,/g, ",");
  };
  const subject = fill(params.subject?.trim() || `Tu acceso al portal de ${params.workspaceName}`);
  const rawBody = params.body?.trim() ?? "";
  let bodyHtml: string;
  if (rawBody && isHtmlTemplate(rawBody)) {
    // Con formato (el editor de Ajustes del portal): los valores van escapados y lo que sale pasa por la lista blanca.
    const template = legacyNameToVariable(rawBody);
    bodyHtml = dropDanglingComma(template, finalizeEmailHtml(interpolateHtml(template, values), true));
  } else {
    const bodyText = fill(rawBody || `Hola${name ? ` ${name}` : ""}, ya tenés tu acceso al portal de ${params.workspaceName}. Entrá con el botón para activar tu cuenta.`);
    bodyHtml = bodyText
      .split(/\n{2,}/)
      .map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(p).replace(/\n/g, "<br />")}</p>`)
      .join("");
  }
  return {
    subject,
    html: brandedEmailHtml({
      brand,
      preheader: `Tu acceso al portal de ${params.workspaceName}. El link vence en 7 días.`,
      body: `
                ${eyebrow("Portal", theme)}
                ${heading(escapeHtml(subject))}
                ${bodyHtml}
                ${button(params.inviteUrl, "Entrar al portal", theme)}
                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
                  El link vence en 7 días. Si no esperabas este email, podés ignorarlo.
                </p>`,
    }),
  };
}

/**
 * El resumen semanal del estudiante (F128) con la plantilla del sistema (la marca del negocio: logo, color, botón).
 * Secciones solo si tienen algo, referidos siempre al final (las arma `digestSections`). Lleva cómo apagarlo.
 */
export function portalDigestEmail(params: {
  brand?: Brand | null;
  studentName: string | null;
  programName: string;
  sections: Array<{ key: string; title: string; text: string }>;
  portalUrl?: string | null;
}): EmailContent {
  const brand = params.brand ?? resolveBrand(null);
  const theme = emailTheme(brand);
  const first = params.studentName?.trim().split(/\s+/)[0] ?? "";
  const subject = `Tu semana en ${params.programName}`;
  const rows = params.sections
    .map(
      (s) => `<tr><td style="padding:14px 0;border-top:1px solid #f0f1f3;">
                    <p style="margin:0;font-size:13px;font-weight:700;color:${theme.ink};">${escapeHtml(s.title)}</p>
                    <p style="margin:4px 0 0;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(s.text)}</p>
                  </td></tr>`,
    )
    .join("");
  return {
    subject,
    html: brandedEmailHtml({
      brand,
      preheader: `Lo de tu semana en ${params.programName}.`,
      body: `
                ${eyebrow("Tu semana", theme)}
                ${heading(`${first ? `Hola, ${escapeHtml(first)}` : "Hola"}: esto es lo de tu semana`)}
                <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#374151;">En <strong>${escapeHtml(params.programName)}</strong>.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
                ${params.portalUrl ? button(params.portalUrl, "Entrar al portal", theme) : ""}`,
      footerNote: "Te llega los lunes. Lo podés apagar desde tu Perfil en el portal, en Notificaciones.",
    }),
  };
}

/**
 * El código para entrar al portal (B2, F202): 6 dígitos que vencen en 10 minutos y, en el mismo email, el link
 * mágico que entra sin tipearlo. Transaccional: sale aunque la persona se haya dado de baja de marketing.
 */
export function portalLoginCodeEmail(params: { brand?: Brand | null; workspaceName: string; code: string; magicUrl: string | null; studentName?: string | null }): EmailContent {
  const brand = params.brand ?? resolveBrand(null);
  const theme = emailTheme(brand);
  const first = params.studentName?.trim().split(/\s+/)[0] ?? "";
  const code = escapeHtml(params.code);
  return {
    subject: `Tu código para entrar: ${params.code}`,
    html: brandedEmailHtml({
      brand,
      preheader: `Tu código para entrar al portal de ${params.workspaceName}. Vence en 10 minutos.`,
      body: `
                ${eyebrow("Portal", theme)}
                ${heading(`${first ? `${escapeHtml(first)}, este` : "Este"} es tu código para entrar`)}
                <p style="margin:24px 0 0;text-align:center;font-size:34px;letter-spacing:0.3em;font-weight:700;color:#111827;font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${code}</p>
                <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#6b7280;text-align:center;">Vence en 10 minutos.</p>
                ${params.magicUrl ? button(params.magicUrl, "Entrar sin tipear el código", theme) : ""}
                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
                  Si no pediste entrar, ignorá este email: nadie puede entrar sin este código.
                </p>`,
    }),
  };
}

/** «Lo que vence hoy» por email (F128): solo si la persona lo prendió en su Perfil y el programa lo tiene prendido. */
export function portalDueTodayEmail(params: {
  brand?: Brand | null;
  studentName: string | null;
  programName: string;
  items: Array<{ name: string; time?: string | null }>;
  portalUrl?: string | null;
}): EmailContent {
  const brand = params.brand ?? resolveBrand(null);
  const theme = emailTheme(brand);
  const first = params.studentName?.trim().split(/\s+/)[0] ?? "";
  const n = params.items.length;
  const subject = n === 1 ? `Hoy vence «${params.items[0].name}»` : `Hoy vencen ${n} cosas en ${params.programName}`;
  const list = params.items
    .map((i) => `<li style="margin:0 0 6px;font-size:15px;line-height:1.5;color:#374151;">${escapeHtml(i.name)}${i.time ? ` <span style="color:#6b7280;">· hasta las ${escapeHtml(i.time)}</span>` : ""}</li>`)
    .join("");
  return {
    subject,
    html: brandedEmailHtml({
      brand,
      preheader: n === 1 ? `Hoy vence «${params.items[0].name}».` : `Hoy vencen ${n} cosas. Vos podés.`,
      body: `
                ${eyebrow("Para hoy", theme)}
                ${heading(`${first ? `${escapeHtml(first)}, hoy` : "Hoy"} ${n === 1 ? "vence esto" : "vencen estas cosas"}`)}
                <ul style="margin:0;padding-left:20px;">${list}</ul>
                <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#374151;">Un paso a la vez: lo tenés.</p>
                ${params.portalUrl ? button(params.portalUrl, "Ir al portal", theme) : ""}`,
      footerNote: "Lo prendiste en tu Perfil del portal. Lo podés apagar ahí, en Notificaciones.",
    }),
  };
}
// @plantilla-hasta(servicios)

// @plantilla-desde(proyectos)
/**
 * «Pedir comprobante» (Corrida C, F120): el equipo le pide al estudiante el comprobante de un pago que reportó. Sin
 * comprobante el pago queda sin verificar y no cuenta en la Sala de la fama. El botón lleva a su Facturación.
 */
export function portalReceiptRequestEmail(params: { brand?: Brand | null; workspaceName: string; studentName?: string | null; paymentTitle: string; amount: string; receivedOn: string; url: string | null }): EmailContent {
  const brand = params.brand ?? resolveBrand(null);
  const theme = emailTheme(brand);
  const name = params.studentName?.trim().split(/\s+/)[0] ?? "";
  const subject = `Te falta el comprobante de un pago`;
  return {
    subject,
    html: brandedEmailHtml({
      brand,
      preheader: `Subí el comprobante de «${params.paymentTitle}» para que cuente en la Sala de la fama.`,
      body: `
                ${eyebrow("Portal", theme)}
                ${heading(escapeHtml(subject))}
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151;">Hola${name ? ` ${escapeHtml(name)}` : ""}, para verificar el pago que reportaste en ${escapeHtml(params.workspaceName)} necesitamos el comprobante:</p>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151;"><strong>${escapeHtml(params.paymentTitle)}</strong> · ${escapeHtml(params.amount)} · ${escapeHtml(params.receivedOn)}</p>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151;">Sin comprobante el pago queda sin verificar y no cuenta en la Sala de la fama.</p>
                ${params.url ? button(params.url, "Subir el comprobante", theme) : ""}`,
    }),
  };
}
// @plantilla-hasta(proyectos)

/**
 * Un aviso de la campana que la persona eligio recibir tambien por email
 * (Mi cuenta → Notificaciones). Siempre dice de que negocio es (arriba, con su
 * marca) y lleva al mismo lugar que el aviso en la campana; al pie, donde se
 * cambia.
 */
export function teamNotificationEmail(params: {
  title: string;
  body?: string | null;
  /** Link absoluto a lo que avisa, o null si el aviso no lleva a ningun lado. */
  url: string | null;
  /** Link absoluto a Mi cuenta → Notificaciones. */
  settingsUrl: string;
  businessName?: string | null;
  /** La marca del negocio del aviso. Sin ella, la de la instalación. */
  brand?: Brand | null;
}): EmailContent {
  const brand = params.brand ?? resolveBrand(null);
  const theme = emailTheme(brand);
  return {
    subject: params.businessName ? `${params.businessName}: ${params.title}` : params.title,
    html: brandedEmailHtml({
      brand,
      preheader: params.body?.trim() || params.title,
      footerNote: `Te llega porque lo elegiste en Mi cuenta. <a href="${escapeHtml(params.settingsUrl)}" target="_blank" style="color:#6b7280;text-decoration:underline;">Cambiar qué avisos recibo</a>`,
      body: `
                ${eyebrow("Aviso", theme)}
                ${heading(escapeHtml(params.title))}
                ${params.body ? `<p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(params.body)}</p>` : ""}
                ${params.url ? button(params.url, "Ver en el sistema", theme) : ""}`,
    }),
  };
}

/**
 * El link de baja que la persona pidió desde la web del negocio ("mandame un link nuevo",
 * `POST /api/public/email/unsubscribe-link`). Transaccional: lo pidió ella. El link es
 * `/baja/<token>`, donde elige darse de baja (abrirlo no da de baja).
 */
export function unsubscribeLinkEmail(params: { unsubscribeUrl: string; brand?: Brand | null }): EmailContent {
  const brand = params.brand ?? resolveBrand(null);
  const theme = emailTheme(brand);
  const name = escapeHtml(brand.name);
  return {
    subject: `Tu link para dejar de recibir emails de ${brand.name}`,
    html: brandedEmailHtml({
      brand,
      preheader: `Desde este link elegís dejar de recibir los emails de ${brand.name}.`,
      body: `
                ${eyebrow("Tus emails", theme)}
                ${heading("Tu link para darte de baja")}
                <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">Pediste un link para dejar de recibir los emails de <strong>${name}</strong>. Desde ahí lo confirmás con un clic.</p>
                ${button(params.unsubscribeUrl, "Elegir qué emails recibo", theme)}
                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
                  Si no lo pediste vos, podés ignorar este email: no cambia nada.
                </p>`,
    }),
  };
}
