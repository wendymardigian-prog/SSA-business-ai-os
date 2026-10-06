"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  dismissToast,
  pushToast,
  toastDurationMs,
  type ToastInput,
  type ToastItem,
} from "@/lib/content/toast";
import { cn } from "@/lib/utils";

/**
 * Los avisos de Contenido (F95).
 *
 * Viven AFUERA del drawer, en el tablero: cuando el drawer se cierra (al
 * descartar la ultima idea, por ejemplo) el aviso tiene que seguir ahi. Se
 * anuncian con `role="status"` y `aria-live`, que es lo que las pantallas del
 * proyecto ya hacen por su cuenta; esto lo comparte.
 */

interface ToastApi {
  push: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastApi>({ push: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const TONES: Record<ToastItem["tone"], string> = {
  ok: "border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  info: "border-border bg-popover text-popover-foreground",
  warning: "border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  error: "border-red-500/40 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((list) => dismissToast(list, id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setItems((list) => pushToast(list, toast, id));
      timers.current.set(id, setTimeout(() => dismiss(id), toastDurationMs(toast.tone)));
    },
    [dismiss],
  );

  // Al desmontar no queda ningun reloj corriendo.
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const timer of live.values()) clearTimeout(timer);
      live.clear();
    };
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4"
      >
        {items.map((item) => (
          <p
            key={item.id}
            className={cn(
              "pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg",
              TONES[item.tone],
            )}
          >
            <span className="min-w-0 flex-1">{item.text}</span>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Cerrar aviso"
              className="-mr-1 rounded p-0.5 opacity-70 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
