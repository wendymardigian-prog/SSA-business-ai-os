"use client";

/**
 * Guardado automático: cuando el valor cambia, espera a que la persona deje de escribir (`delay`) y lo guarda.
 *
 * Reglas que importan:
 * - Una sola llamada a la vez. Si mientras se guarda la persona sigue escribiendo, al terminar se guarda lo nuevo.
 * - Lo que se guarda es el valor que había AL EMPEZAR; nunca se da por guardado algo que cambió en el medio.
 * - Un error no pierde nada: el texto sigue en pantalla, el estado dice que falló y `flush` lo reintenta.
 * - Se guarda ya (sin esperar) al salir de un campo, al ocultarse la pestaña y al cerrar el panel.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export function useAutosave<T>({
  value,
  initial,
  save,
  equals,
  delay = 1200,
}: {
  value: T;
  /** Lo que ya está guardado al abrir. */
  initial: T;
  /** Guarda el valor. Devuelve `{ ok: false, error }` si no pudo; no debe lanzar. */
  save: (value: T) => Promise<{ ok: true } | { ok: false; error: string }>;
  equals: (a: T, b: T) => boolean;
  delay?: number;
}) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const valueRef = useRef(value);
  const savedRef = useRef(initial);
  const saveRef = useRef(save);
  const equalsRef = useRef(equals);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    valueRef.current = value;
    saveRef.current = save;
    equalsRef.current = equals;
  });

  const run = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // Ya hay un guardado en curso: ese mismo ciclo vuelve a mirar si quedó algo nuevo cuando termine.
    if (inFlight.current) return;
    inFlight.current = true;
    let didSave = false;
    try {
      // Mientras haya algo distinto de lo guardado (por ejemplo, la persona siguió escribiendo durante el guardado), se guarda.
      while (!equalsRef.current(valueRef.current, savedRef.current)) {
        const snapshot = valueRef.current;
        if (alive.current) {
          setStatus("saving");
          setError(null);
        }
        let result: { ok: true } | { ok: false; error: string };
        try {
          result = await saveRef.current(snapshot);
        } catch {
          result = { ok: false, error: "No pude guardar. Revisá tu conexión." };
        }
        if (!result.ok) {
          if (alive.current) {
            setStatus("error");
            setError(result.error);
          }
          return;
        }
        savedRef.current = snapshot;
        didSave = true;
      }
      if (didSave && alive.current) setStatus("saved");
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Cada cambio arma (o reinicia) la espera.
  useEffect(() => {
    if (equalsRef.current(value, savedRef.current)) return;
    if (!inFlight.current) setStatus("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delay, run]);

  // Al ocultarse la pestaña o cerrar el panel, lo pendiente se guarda ya.
  useEffect(() => {
    alive.current = true;
    const onHide = () => {
      if (document.visibilityState === "hidden") void run();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide as EventListener);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide as EventListener);
      alive.current = false;
      void run();
    };
  }, [run]);

  return { status, error, flush: run };
}
