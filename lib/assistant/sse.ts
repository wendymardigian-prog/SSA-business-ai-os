/**
 * Eventos del servidor al navegador para el asistente a pantalla completa. Formato `text/event-stream`:
 * `event: <tipo>\ndata: <json>\n\n`. La pantalla igual se vuelve a dibujar desde lo guardado: esto solo la adelanta.
 *
 * Módulo puro.
 */

export function encodeSse(event: string, data: unknown): string {
  const name = event.replace(/[\r\n]/g, "");
  // JSON nunca trae saltos de línea sin escapar, así que cabe en una sola línea `data:`.
  return `event: ${name}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
}

export interface SseMessage {
  event: string;
  data: unknown;
}

/**
 * Lector por trozos: lo que llega por la red se corta en cualquier sitio, así que guarda el resto hasta el siguiente
 * trozo. Un `data` que no es JSON se ignora (nunca rompe la pantalla).
 */
export function createSseReader(onMessage: (m: SseMessage) => void): { push: (chunk: string) => void; end: () => void } {
  let buffer = "";
  const flush = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) return;
    try {
      onMessage({ event, data: JSON.parse(data.join("\n")) });
    } catch {
      /* trozo que no es JSON: se ignora */
    }
  };
  return {
    push(chunk) {
      buffer += chunk;
      let idx = buffer.search(/\r?\n\r?\n/);
      while (idx >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(buffer.slice(idx).match(/^\r?\n\r?\n/)![0].length + idx);
        flush(block);
        idx = buffer.search(/\r?\n\r?\n/);
      }
    },
    end() {
      if (buffer.trim()) flush(buffer);
      buffer = "";
    },
  };
}
