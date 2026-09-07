/**
 * Plantillas de los emails transaccionales.
 *
 * HTML simple a proposito: los clientes de email rompen casi todo el CSS
 * moderno, asi que se usan estilos en linea y una sola columna. Sin imagenes
 * remotas (muchos clientes las bloquean por defecto).
 */

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

function button(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;margin:24px 0;padding:12px 20px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${escapeHtml(label)}</a>
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0;">Si el boton no funciona, copia y pega este link en tu navegador:<br />
      <span style="color:#374151;word-break:break-all;">${escapeHtml(url)}</span>
    </p>`;
}

/** Invitacion a sumarse al workspace. */
export function teamInviteEmail(params: {
  workspaceName: string;
  inviteUrl: string;
  roleLabel: string;
}): EmailContent {
  return {
    subject: `Te invitaron a ${params.workspaceName}`,
    html: layout(`
      <h1 style="font-size:20px;margin:0 0 12px;">Te sumaron a ${escapeHtml(params.workspaceName)}</h1>
      <p style="font-size:15px;line-height:1.6;margin:0;">
        Vas a entrar con el rol <strong>${escapeHtml(params.roleLabel)}</strong>.
        El link vence en 7 dias.
      </p>
      ${button(params.inviteUrl, "Aceptar la invitacion")}
    `),
  };
}

/** Aviso a los admins de que un canal se cayo o cambio de estado. */
export function channelAlertEmail(params: {
  title: string;
  body: string;
  appUrl: string;
}): EmailContent {
  return {
    subject: params.title,
    html: layout(`
      <h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(params.title)}</h1>
      <p style="font-size:15px;line-height:1.6;margin:0;">${escapeHtml(params.body)}</p>
      ${button(`${params.appUrl}/dashboard/channels`, "Ver los canales")}
    `),
  };
}
