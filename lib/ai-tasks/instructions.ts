/**
 * Las instrucciones editables de cada tarea de IA, y cómo se arma el prompt
 * final con ellas.
 *
 * Cada prompt de hoy mezcla dos cosas: lo editable (qué hacer, con qué
 * criterio) y lo técnico (las reglas anti-inyección y el formato JSON exacto
 * que el código después parsea). Solo lo primero se versiona (Bloque
 * Agentes IA, instrucciones): si alguien edita el formato de salida, la tarea
 * deja de funcionar sin avisar, así que esa parte queda SIEMPRE fija, nunca
 * sale del código.
 *
 * `{{variable}}` en una instrucción se reemplaza por el valor real de esa
 * corrida (`interpolate`); lo que no reconoce lo deja tal cual, nunca lanza.
 *
 * Puro, sin dependencias de servidor: lo prueba `instructions.test.ts`, que
 * fija que con el texto por defecto el prompt final de cada tarea queda
 * byte a byte igual al de antes del Bloque.
 */

export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}

/** Editable + técnica, en ese orden, separadas como estaban antes de partirlas. */
export function assembleTaskPrompt(editable: string, technical: string, separator = "\n\n"): string {
  return technical ? `${editable}${separator}${technical}` : editable;
}

// ---------------------------------------------------------------------------
// Clasificación de mensajes (lib/patterns/prompt.ts, buildSystemPrompt)
// ---------------------------------------------------------------------------

export const CLASSIFY_DEFAULT_INSTRUCTIONS = `Agrupás mensajes {{direccion}} según lo que SIGNIFICAN, no según las palabras que usan.

Tu tarea: para cada texto numerado, elegir la categoría que le corresponde.

Reglas:
- Si alguna categoría existente le queda bien, usá su número. Preferí siempre una existente antes que inventar una nueva.
- Si ninguna le queda bien y el texto representa una intención clara y repetible, proponé UNA categoría nueva con nombre corto (2 a 4 palabras) y una descripción de una línea.
- Podés proponer como máximo {{max_nuevas_categorias}} categorías nuevas en todo el lote. Reutilizá una que ya propusiste antes de proponer otra.
- Si el texto no tiene intención clara, es ambiguo o no encaja en ningún grupo útil, mandalo a la categoría de descarte.
- La confianza va de 0 a 1 y tiene que ser honesta: 0,9 es "estoy seguro", 0,5 es "podría ser otra".`;

// ---------------------------------------------------------------------------
// Resumen de conversación (lib/agent/summary.ts, buildSummarySystemPrompt)
// ---------------------------------------------------------------------------

export const SUMMARY_DEFAULT_INSTRUCTIONS = [
  "Sos quien mantiene la memoria del negocio sobre cada contacto. Recibis el resumen previo (si existe) y los mensajes nuevos de una conversacion que acaba de cerrarse.",
  "Escribi un resumen INTEGRADO en {{estilo}}, en tercera persona, con: temas hablados, decisiones, preferencias, problemas reportados, compromisos y proximo paso sugerido.",
  "Reconciliacion: si un dato nuevo contradice o corrige uno del resumen previo (cambio de plan, de fecha, de preferencia), quedate con el NUEVO y no dejes el viejo. Nunca acumules versiones contradictorias.",
  "Largo maximo: {{largo_maximo}} caracteres. Si no entra, condensa lo mas antiguo y conserva lo reciente y lo relevante para vender o atender.",
  "No inventes nada que no este en los mensajes o en el resumen previo. Si un dato no se sabe, no lo pongas.",
].join("\n");

// ---------------------------------------------------------------------------
// Descripción de imágenes (lib/jobs/handlers/describe-media.ts, PROMPT)
// ---------------------------------------------------------------------------

export const MEDIA_DESCRIPTION_DEFAULT_INSTRUCTIONS = [
  "Describí esta imagen en español, en una sola frase de máximo 300 caracteres.",
  "Decí qué se ve y, si la imagen tiene texto (por ejemplo una captura de pantalla),",
  "transcribí lo que dice el texto, que es lo más importante.",
  "No interpretes ni opines: describí.",
].join(" ");
