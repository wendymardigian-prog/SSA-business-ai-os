/**
 * La cola serial de guardado de la pantalla de roles (Equipo y roles, F13).
 *
 * Cada tilde o selector se guarda al instante. Si dos cambios salen a la vez, el segundo puede
 * llegar al servidor ANTES que el primero y pisarlo. La cola los corre de a uno, en el orden en que
 * se pidieron. Un guardado que falla no frena a los que siguen: cada trabajo devuelve su propio
 * resultado (la pantalla revierte SOLO ese control).
 *
 * Puro: no sabe de React ni de Supabase.
 */
export interface SaveQueue {
  /** Agrega un trabajo al final. Devuelve lo que devuelva el trabajo (o su error). */
  enqueue<T>(job: () => Promise<T>): Promise<T>;
  /** Cuantos trabajos hay sin terminar (el que corre cuenta). */
  pending(): number;
}

export function createSaveQueue(onChange?: (pending: number) => void): SaveQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  const bump = (delta: number) => {
    pending += delta;
    onChange?.(pending);
  };

  return {
    enqueue<T>(job: () => Promise<T>): Promise<T> {
      bump(1);
      const run = tail.then(job);
      // El siguiente espera a este, sea cual sea el resultado.
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run.finally(() => bump(-1));
    },
    pending: () => pending,
  };
}
