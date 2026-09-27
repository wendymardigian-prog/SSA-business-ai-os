/**
 * Cambiar la fecha de una red ya programada, desde el editor (A5).
 *
 * El editor guarda `networks` y nada mas. Si una red ya estaba programada y
 * le cambiabas la fecha, el campo quedaba con la fecha nueva y la
 * publicacion salia a la vieja: la pantalla decia una cosa y el sistema
 * hacia otra.
 *
 * Lo que decide que hay que reprogramar es puro y esta aca; escribir la fila
 * y el job es de la accion.
 */

import { MIN_LEAD_MINUTES, type ExistingPublication, type NetworkPlan } from "./schedule";

export type RescheduleDecision =
  | { platform: string; kind: "reschedule"; at: string }
  | { platform: string; kind: "skip"; reason: string };

/**
 * Que redes ya programadas cambiaron de fecha.
 *
 * Solo mira las que estan `scheduled`: una publicada no se mueve, y una que
 * nunca se programo solo tiene fecha tentativa, que es justamente lo que se
 * guarda sin agendar nada.
 */
export function plannedDateChanges(
  networks: NetworkPlan[],
  publications: ExistingPublication[],
  now: Date = new Date(),
): RescheduleDecision[] {
  const out: RescheduleDecision[] = [];

  for (const network of networks) {
    const publication = publications.find((p) => p.platform === network.platform);
    if (!publication || publication.status !== "scheduled") continue;

    if (!network.plannedAt) {
      // Borrar la fecha de una red programada no la desprograma sola: eso es
      // un acto explicito, con su boton.
      out.push({
        platform: network.platform,
        kind: "skip",
        reason: "Para sacarla de la cola usa Desprogramar.",
      });
      continue;
    }

    const at = new Date(network.plannedAt);
    if (Number.isNaN(at.getTime())) {
      out.push({ platform: network.platform, kind: "skip", reason: "Esa fecha no se entiende." });
      continue;
    }

    const current = publication.scheduledAt ? new Date(publication.scheduledAt).getTime() : null;
    if (current !== null && current === at.getTime()) continue;

    const minutes = (at.getTime() - now.getTime()) / 60000;
    if (minutes < MIN_LEAD_MINUTES) {
      out.push({
        platform: network.platform,
        kind: "skip",
        reason: `Falta muy poco: elegi una hora al menos ${MIN_LEAD_MINUTES} minutos despues de ahora.`,
      });
      continue;
    }

    out.push({ platform: network.platform, kind: "reschedule", at: at.toISOString() });
  }

  return out;
}
