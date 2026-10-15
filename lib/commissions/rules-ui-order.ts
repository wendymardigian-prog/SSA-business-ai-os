/**
 * Ordenar las reglas de un rol (F57). Puro: arrastrar, el aviso para el lector de pantalla y el guardado
 * inmediato en serie.
 *
 * El orden se guarda apenas se suelta o se mueve con el teclado. Si se mueve varias veces seguidas, no se mandan
 * guardados en paralelo (el servidor cambia las posiciones de a una y dos guardados a la vez se pisarían): se
 * guarda uno, y cuando termina, el último orden pedido. Si uno falla, se vuelve al último orden que el servidor
 * confirmó.
 */

/** El orden que queda al soltar `draggedId` antes o después de `overId`. Si algo no existe, el orden no cambia. */
export function applyDrop(ids: readonly string[], draggedId: string, overId: string, placeAfter: boolean): string[] {
  if (draggedId === overId) return [...ids];
  const without = ids.filter((id) => id !== draggedId);
  const over = without.indexOf(overId);
  if (over < 0 || !ids.includes(draggedId)) return [...ids];
  const index = placeAfter ? over + 1 : over;
  return [...without.slice(0, index), draggedId, ...without.slice(index)];
}

/** ¿Se suelta en la mitad de abajo de la fila? (`offsetY` es la altura del puntero dentro de la fila.) */
export function isLowerHalf(offsetY: number, rowHeight: number): boolean {
  return rowHeight > 0 && offsetY > rowHeight / 2;
}

/** Lo que anuncia el lector de pantalla después de mover una regla (`position` empieza en 1). */
export function moveAnnouncement(name: string, position: number, total: number): string {
  const label = name.trim() ? `«${name.trim()}»` : "La regla";
  return `${label} movida al lugar ${position} de ${total}`;
}

export type OrderSaveResult = { ok: true } | { ok: false; error: string };

export interface OrderSaverHandlers {
  save: (ids: string[]) => Promise<OrderSaveResult>;
  /** Un guardado falló: vuelve al último orden confirmado. */
  onFail: (committed: string[], error: string) => void;
  /** Se guardó todo lo pedido y no queda nada en cola. */
  onIdle?: () => void;
}

export interface OrderSaver {
  /** Pone (o cambia) lo que hace cada paso. Se puede llamar en cada render: usa siempre lo último. */
  configure(handlers: OrderSaverHandlers): void;
  /** Pide guardar este orden. Si ya hay un guardado en curso, queda para después (solo importa el último). */
  request(ids: string[]): void;
  /** El último orden que el servidor confirmó. */
  committed(): string[];
}

export function createOrderSaver(initial: readonly string[], first?: OrderSaverHandlers): OrderSaver {
  let committed = [...initial];
  let next: string[] | null = null;
  let running = false;
  let handlers: OrderSaverHandlers | null = first ?? null;

  async function run() {
    running = true;
    while (next) {
      const ids = next;
      next = null;
      let result: OrderSaveResult;
      try {
        result = handlers ? await handlers.save(ids) : { ok: false, error: "No pude guardar el orden. Probá de nuevo." };
      } catch {
        result = { ok: false, error: "No pude guardar el orden. Probá de nuevo." };
      }
      if (result.ok) {
        committed = ids;
      } else {
        next = null;
        running = false;
        handlers?.onFail([...committed], result.error);
        return;
      }
    }
    running = false;
    handlers?.onIdle?.();
  }

  return {
    configure(h) {
      handlers = h;
    },
    request(ids) {
      next = [...ids];
      if (!running) void run();
    },
    committed: () => [...committed],
  };
}
