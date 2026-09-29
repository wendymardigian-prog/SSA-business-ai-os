/**
 * Un borrador vacio porque fallo el modelo, explicado en la cola.
 *
 * Antes se veia como una fila en blanco con "Fallaron el modelo principal y el
 * de respaldo": cierto, pero no dice que hacer. El 28/9 una API key revocada
 * dejo al agente sin contestar y la cola no ayudaba a encontrarlo.
 *
 * Reusa `describeModelError` (lib/agent/run-labels.ts), que ya traduce el texto
 * tecnico del run a una accion. Lo unico que agrega es separar el titular de
 * la pista accionable, y a donde se arregla.
 */

import { describeModelError } from "@/lib/agent/run-labels";

export interface ModelFailureNotice {
  /** Titular en una linea, sin jerga. */
  headline: string;
  /** Que hacer, si el error lo dice. */
  hint: string | null;
  /** El texto tecnico completo, para el detalle desplegable. */
  technical: string | null;
  /** A donde se arregla, si corresponde. */
  href: string | null;
  hrefLabel: string | null;
}

const INTEGRATIONS = "/dashboard/settings/integrations";

/**
 * El aviso de un borrador sin texto por una falla del modelo, o null si el
 * borrador esta vacio por otro motivo (guardarrail, sugerencia de derivar).
 */
export function modelFailureNotice(
  noReplyReason: string | null | undefined,
  runError: string | null | undefined,
): ModelFailureNotice | null {
  if (!noReplyReason || !noReplyReason.startsWith("error:")) return null;
  const kind = noReplyReason.slice("error:".length);

  // Una salida que no paso la validacion no es una falla del proveedor: no
  // manda a revisar la integracion, que no tiene nada que ver.
  if (kind.startsWith("output_")) {
    return {
      headline: "El modelo respondió algo que no se pudo usar",
      hint: "Se puede revisar el formato de respuesta en la configuración del agente.",
      technical: runError ?? null,
      href: null,
      hrefLabel: null,
    };
  }

  const headline =
    kind === "model_timeout"
      ? "El modelo no respondió a tiempo"
      : "El modelo no respondió — revisá la integración de IA";

  const full = runError ? describeModelError(runError) : "";
  const hint = full && runError && full !== runError ? full.split(" · ")[0] : null;

  return {
    headline,
    hint,
    technical: runError ?? null,
    href: INTEGRATIONS,
    hrefLabel: "Ver la integración de IA",
  };
}
