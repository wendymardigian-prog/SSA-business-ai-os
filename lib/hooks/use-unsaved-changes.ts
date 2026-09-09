"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Aviso de cambios sin guardar.
 *
 * No existia en ningun lado del repo: el editor de secuencias y el flow builder
 * pierden todo lo editado si te vas sin guardar, sin una sola señal.
 *
 * Cubre lo que se puede cubrir:
 *   - cerrar la pestaña, recargar o salir del sitio -> beforeunload
 *   - los botones de salida conocidos -> guard(), que abre un ConfirmDialog
 *
 * Lo que NO cubre, y conviene saberlo: la navegacion interna del App Router.
 * Next 16 no expone una API estable para bloquearla, asi que un click en el
 * sidebar sigue perdiendo los cambios. Parchear history.pushState o interceptar
 * los clicks a nivel documento se rompe con cada version menor de Next y no
 * vale el riesgo. Si algun dia molesta, la salida correcta es un provider en el
 * layout del dashboard que el sidebar consulte.
 */

export interface UnsavedChangesGuard {
  /** Hay cambios respecto de lo ultimo guardado. */
  dirty: boolean;
  /** Llamar despues de guardar bien: fija el estado actual como el guardado. */
  markSaved: () => void;
  /** Envolve una navegacion: si hay cambios pregunta, si no, va derecho. */
  guard: (navigate: () => void) => void;
  /** Para pasarle a <ConfirmDialog {...confirmProps} />. */
  confirmProps: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    destructive: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  };
}

export function useUnsavedChanges({
  current,
  initial,
  enabled = true,
  title = "Tenés cambios sin guardar",
  message = "Si salís ahora se pierden. ¿Querés salir igual?",
  confirmLabel = "Salir sin guardar",
  cancelLabel = "Seguir editando",
}: {
  /** Huella del estado actual (ver lib/unsaved-changes.ts). */
  current: string;
  /** Huella de lo que vino del servidor. */
  initial: string;
  /** false apaga todo: un Member ve la pantalla en modo lectura. */
  enabled?: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): UnsavedChangesGuard {
  // useState y no useRef: markSaved tiene que provocar un re-render para que el
  // indicador pase de "sin guardar" a "guardado".
  const [baseline, setBaseline] = useState(initial);
  const [pending, setPending] = useState<{ navigate: () => void } | null>(null);

  const dirty = enabled && current !== baseline;

  const markSaved = useCallback(() => setBaseline(current), [current]);

  const guard = useCallback(
    (navigate: () => void) => {
      if (!dirty) {
        navigate();
        return;
      }
      setPending({ navigate });
    },
    [dirty]
  );

  useEffect(() => {
    if (!dirty) return;

    const avisar = (event: BeforeUnloadEvent) => {
      // El navegador muestra su propio texto; lo unico que se puede hacer es
      // pedir que pregunte.
      event.preventDefault();
    };

    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [dirty]);

  return {
    dirty,
    markSaved,
    guard,
    confirmProps: {
      open: pending !== null,
      title,
      message,
      confirmLabel,
      cancelLabel,
      destructive: true,
      onConfirm: () => {
        const navegar = pending?.navigate;
        setPending(null);
        navegar?.();
      },
      onCancel: () => setPending(null),
    },
  };
}
