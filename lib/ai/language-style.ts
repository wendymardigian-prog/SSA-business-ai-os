/**
 * Como escribe la IA en español: una variable por instalacion, nunca un
 * dialecto fijo en el código. `AI_LANGUAGE_STYLE` en Railway, por ejemplo
 * "español rioplatense (vos/tenés)" o "español mexicano (tú)".
 *
 * Desde la 00266 cada negocio puede tener el suyo
 * (`workspaces.ai_language_style`, Ajustes → General → Marca): quien lo pasa
 * gana; sin el, el de la instalacion; sin ninguno, el neutro. El servidor lo
 * lee con `loadLanguageStyle` (lib/ai/language-style-load.ts) o, para las
 * tareas de IA, ya viene puesto en las instrucciones de
 * `loadTaskInstructionsForRun` (lib/ai-tasks/store.ts).
 *
 * Es server-only (no `NEXT_PUBLIC_`) porque solo la leen los prompts de IA,
 * que corren en el servidor: no hace falta mandarla al bundle del navegador.
 */
const DEFAULT_STYLE = "español neutro, directo y sin relleno";

export function aiLanguageStyle(workspaceStyle?: string | null): string {
  return workspaceStyle?.trim() || process.env.AI_LANGUAGE_STYLE?.trim() || DEFAULT_STYLE;
}
