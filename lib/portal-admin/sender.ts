// @plantilla-quitar(servicios)
/**
 * «Enviar desde» de Ajustes del portal: lo de antes del @ + un dominio VERIFICADO de la cuenta de Resend del negocio.
 * No se escribe un dominio a mano (decisión del 8/11/2026): uno sin verificar haría que la invitación no salga.
 * Puro: lo usan la pantalla y la acción que guarda.
 */
import { isVerifiedDomain, splitAddress, validateSenderLocal, type ResendDomain } from "@/lib/email/senders";

/** Los dominios que se pueden elegir: solo los verificados, en minúsculas y sin repetir. */
export function verifiedSenderDomains(domains: readonly ResendDomain[]): string[] {
  return [...new Set(domains.filter(isVerifiedDomain).map((d) => d.name.toLowerCase()))].sort((a, b) => a.localeCompare(b));
}

/**
 * Por qué no se puede guardar este remitente, o null si está bien. `null` como dirección = «el remitente del negocio»
 * (siempre se puede). Lo que ya estaba guardado y no cambió se acepta aunque Resend no conteste, para no trabar el
 * resto de los ajustes por una caída de Resend.
 */
export function portalSenderProblem(fromEmail: string | null, previous: string | null, verified: readonly string[] | null): string | null {
  if (fromEmail === null) return null;
  const parts = splitAddress(fromEmail);
  if (!parts) return "Elegí lo de antes del @ y un dominio";
  const localProblem = validateSenderLocal(parts.local);
  if (localProblem) return localProblem;
  if (previous !== null && previous.trim().toLowerCase() === fromEmail.trim().toLowerCase()) return null;
  if (verified === null) return "No pude comprobar tus dominios en Resend. Probá de nuevo en un rato o elegí «el remitente del negocio».";
  if (!verified.includes(parts.domain)) return `El dominio ${parts.domain} no está verificado en tu Resend: elegí uno de la lista.`;
  return null;
}
