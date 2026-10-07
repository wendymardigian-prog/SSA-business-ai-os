/**
 * Como escribe el agente en español: una variable por cliente, nunca un
 * dialecto fijo en el código. `AI_LANGUAGE_STYLE` en Railway, por ejemplo
 * "español rioplatense (vos/tenés)" o "español mexicano (tú)".
 *
 * Es server-only (no `NEXT_PUBLIC_`) porque solo la leen los prompts de IA,
 * que corren en el servidor: no hace falta mandarla al bundle del navegador.
 */
const DEFAULT_STYLE = "español neutro, directo y sin relleno";

export function aiLanguageStyle(): string {
  return process.env.AI_LANGUAGE_STYLE?.trim() || DEFAULT_STYLE;
}
