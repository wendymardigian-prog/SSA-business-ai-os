/**
 * Repartir en columnas lo que se superpone en la rejilla horaria (R7). PURO.
 *
 * Una agenda y una tarea (o dos tareas) en el mismo horario se dibujan LADO A LADO en vez de una encima de la otra. Se usa
 * SOLO cuando el interruptor de tareas esta encendido: sin el, el calendario de agendas se dibuja como siempre.
 */

export interface Span {
  id: string;
  /** Minutos desde la medianoche. */
  start: number;
  /** Fin en minutos; si no es mayor que el inicio se toma `minLength` (lo que ocupa una tarjeta aunque dure poco). */
  end: number;
}

export interface PlacedSpan extends Span {
  /** Columna (0, 1, ...) dentro de su grupo. */
  column: number;
  /** Cuantas columnas tiene su grupo: el ancho de cada uno es 1 / columns. */
  columns: number;
}

/**
 * Agrupa lo que se pisa (de forma encadenada: si A pisa a B y B a C, los tres son un grupo) y le da a cada uno la primera
 * columna libre. Dentro del grupo todos comparten el mismo numero de columnas. El resultado conserva el orden de entrada.
 */
export function layoutOverlaps(spans: readonly Span[], minLength = 30): PlacedSpan[] {
  const norm = spans.map((s) => ({ ...s, end: Math.max(s.end, s.start + minLength) }));
  const order = norm.map((_, i) => i).sort((a, b) => norm[a].start - norm[b].start || norm[a].end - norm[b].end || (norm[a].id < norm[b].id ? -1 : 1));

  const out = new Map<number, PlacedSpan>();
  let cluster: number[] = [];
  let clusterEnd = -Infinity;
  const columnsEnd: number[] = [];

  const flush = () => {
    const columns = columnsEnd.length;
    for (const index of cluster) out.set(index, { ...(out.get(index) as PlacedSpan), columns });
    cluster = [];
    columnsEnd.length = 0;
    clusterEnd = -Infinity;
  };

  for (const index of order) {
    const s = norm[index];
    if (cluster.length > 0 && s.start >= clusterEnd) flush();
    let column = columnsEnd.findIndex((end) => end <= s.start);
    if (column === -1) {
      column = columnsEnd.length;
      columnsEnd.push(s.end);
    } else {
      columnsEnd[column] = s.end;
    }
    cluster.push(index);
    clusterEnd = Math.max(clusterEnd, s.end);
    out.set(index, { id: s.id, start: spans[index].start, end: spans[index].end, column, columns: 1 });
  }
  flush();
  return spans.map((_, i) => out.get(i) as PlacedSpan);
}
