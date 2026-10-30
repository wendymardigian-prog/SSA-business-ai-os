/**
 * Plantillas de los emails transaccionales.
 *
 * HTML simple a proposito: los clientes de email rompen casi todo el CSS
 * moderno, asi que se usan estilos en linea y una sola columna. Sin imagenes
 * remotas (muchos clientes las bloquean por defecto).
 *
 * El boton usa el color de marca del negocio que manda el email
 * (`resolveBrand(workspace).colorHex`, lib/brand.ts; si no tiene uno, el de la
 * instalacion): un email no entiende variables CSS, asi que el hex se
 * resuelve aca, en el momento de armar el HTML, no en el navegador.
 */

import { brandColorHex, safeBrandColor } from "@/lib/brand";

interface EmailContent {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Marco comun: todo el HTML del cuerpo entra aca. */
function layout(body: string): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
      ${body}
    </div>
  </body>
</html>`;
}

function button(url: string, label: string, color?: string | null): string {
  const background = safeBrandColor(color) ?? brandColorHex() ?? "#111827";
  return `<a href="${escapeHtml(url)}" style="display:inline-block;margin:24px 0;padding:12px 20px;background:${background};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${escapeHtml(label)}</a>
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0;">Si el boton no funciona, copia y pega este link en tu navegador:<br />
      <span style="color:#374151;word-break:break-all;">${escapeHtml(url)}</span>
    </p>`;
}

/** Invitacion a sumarse al workspace. */
export function teamInviteEmail(params: {
  workspaceName: string;
  inviteUrl: string;
  roleLabel: string;
  /** El color del negocio que invita (00266). Sin él, el de la instalación. */
  brandColor?: string | null;
}): EmailContent {
  return {
    subject: `Te invitaron a ${params.workspaceName}`,
    html: layout(`
      <h1 style="font-size:20px;margin:0 0 12px;">Te sumaron a ${escapeHtml(params.workspaceName)}</h1>
      <p style="font-size:15px;line-height:1.6;margin:0;">
        Vas a entrar con el rol <strong>${escapeHtml(params.roleLabel)}</strong>.
        El link vence en 7 dias.
      </p>
      ${button(params.inviteUrl, "Aceptar la invitacion", params.brandColor)}
    `),
  };
}

/**
 * Un aviso de la campana que la persona eligio recibir tambien por email
 * (Mi cuenta → Notificaciones). Siempre dice de que negocio es y lleva al
 * mismo lugar que el aviso en la campana; al pie, donde se cambia.
 */
export function teamNotificationEmail(params: {
  title: string;
  body?: string | null;
  /** Link absoluto a lo que avisa, o null si el aviso no lleva a ningun lado. */
  url: string | null;
  /** Link absoluto a Mi cuenta → Notificaciones. */
  settingsUrl: string;
  businessName?: string | null;
  brandColor?: string | null;
}): EmailContent {
  return {
    subject: params.businessName ? `${params.businessName}: ${params.title}` : params.title,
    html: layout(`
      ${params.businessName ? `<p style="font-size:13px;color:#6b7280;margin:0 0 8px;">${escapeHtml(params.businessName)}</p>` : ""}
      <h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(params.title)}</h1>
      ${params.body ? `<p style="font-size:15px;line-height:1.6;margin:0;">${escapeHtml(params.body)}</p>` : ""}
      ${params.url ? button(params.url, "Ver en el sistema", params.brandColor) : ""}
      <p style="font-size:12px;color:#9ca3af;line-height:1.6;margin:24px 0 0;">
        Te llega porque lo elegiste en Mi cuenta. <a href="${escapeHtml(params.settingsUrl)}" style="color:#6b7280;">Cambiar qué avisos recibo</a>
      </p>
    `),
  };
}
