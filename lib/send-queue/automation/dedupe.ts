/**
 * Un envío por paso, ejecución y destino. PURO.
 *
 * La clave va en un índice único de la base (`uq_send_queue_items_dedupe`, 00420): si el mismo paso de la misma ejecución
 * se vuelve a correr (un reintento del motor, un paso que se reanuda), la segunda fila choca (23505) y se anota como «ya
 * estaba en la cola». Cada mensaje de un paso con varios tiene su propia clave (`index`).
 *
 * `visit` distingue las vueltas de un flujo que pasa DOS veces por el mismo paso en la misma ejecución (un menú que se
 * vuelve a mostrar): cada vuelta es un envío distinto. Lo cuenta quien encola.
 */

export interface DedupeInput {
  flowId: string;
  nodeId: string;
  /** La posición del mensaje dentro del paso (un paso puede mandar varios). */
  index: number;
  sessionId: string;
  /** El destino (conversación, número o grupo). */
  targetKey: string;
  /** Qué vuelta por este paso es (desde 0). */
  visit: number;
}

export function dedupeKey(input: DedupeInput): string {
  const base = `run:${input.flowId}:${input.nodeId}#${input.index}:${input.sessionId}:${input.targetKey}`;
  return input.visit > 0 ? `${base}:v${input.visit}` : base;
}
