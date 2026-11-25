/**
 * Fallos del sistema (25/11/2026, traído de RER): Resend rechaza la clave del negocio (401 o 403). Mientras tanto no
 * sale ningún correo: ni a los leads ni los avisos del equipo. Avisa a Owner y Admin por campana y Slack (el correo
 * de este aviso, justamente, no sale). Un aviso que no se repite en 7 días. Nunca lanza.
 */
import { notifySystemFailure } from "@/lib/notifications/system-alerts";

export function isResendKeyRejected(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

export async function alertResendKeyRejected(supabase: unknown, workspaceId: string, status: number | undefined): Promise<boolean> {
  if (!isResendKeyRejected(status)) return false;
  return notifySystemFailure({
    supabase,
    workspaceId,
    type: "email_provider_error",
    key: "resend",
    title: "Resend rechaza la clave: no sale ningún correo",
    body: `Resend respondió ${status}. No sale ningún correo (ni a leads ni al equipo) hasta que vuelvas a pegar la clave en Integraciones › Resend.`,
    area: "integrations",
    metadata: { status },
  });
}
