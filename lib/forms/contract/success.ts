/**
 * La pantalla de éxito de un contrato (F26). PURO.
 *
 * Con el mensaje por defecto del formulario ("¡Gracias!"), un contrato dice lo que
 * pasa de verdad: que la copia firmada va por email. Si la persona que armó el
 * formulario escribió su propio mensaje (o una redirección), manda el suyo.
 */
import { DEFAULT_SUCCESS, type SuccessConfig } from "@/lib/forms/success";

/**
 * ¿Es el mensaje de siempre? Dos formas: el que trae un formulario nuevo de la base
 * (`{"mode":"message"}`, sin título ni texto) y el genérico "¡Gracias!".
 */
export function isDefaultSuccess(success: SuccessConfig): boolean {
  if (success.mode !== "message" || DEFAULT_SUCCESS.mode !== "message") return false;
  if (success.button) return false;
  const blank = !success.title?.trim() && !success.body?.trim();
  return blank || (success.title === DEFAULT_SUCCESS.title && success.body === DEFAULT_SUCCESS.body);
}

export function contractSuccess(success: SuccessConfig, signerEmail: string): SuccessConfig {
  if (!isDefaultSuccess(success)) return success;
  const email = signerEmail.trim();
  return {
    mode: "message",
    title: "Listo",
    body: email ? `Te mandamos la copia firmada a ${email} en unos minutos.` : "Te mandamos la copia firmada por email en unos minutos.",
    // El botón de descarga se conserva aunque el mensaje sea el de siempre.
    ...(success.mode === "message" && success.downloadContract ? { downloadContract: true } : {}),
  };
}
