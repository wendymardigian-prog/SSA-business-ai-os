"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveEodDraft } from "@/lib/actions/eod/save-draft";
import {
  applyLocalChange,
  beginSend,
  draftStorageKey,
  initialLocal,
  mergeDrafts,
  nextRetryDelay,
  onSaveConflict,
  onSaveOk,
  parseLocalDraft,
  type EodDraftData,
  type LocalDraft,
  type ServerDraft,
} from "@/lib/eod/draft";
import type { SaveDraftResult } from "@/lib/eod/submit";

/**
 * El borrador de un reporte de fin de día en el navegador (E7). Compone las funciones puras
 * de `lib/eod/draft.ts`; acá solo vive lo que es del navegador:
 *
 * - Cada cambio se escribe en `localStorage` en el momento (sincrónico) y se avisa a las
 *   otras pestañas con `BroadcastChannel`.
 * - El servidor recibe los cambios agrupados (1,5 s después del último), y además siempre
 *   que la pestaña se oculta o se cierra (`fetch` con `keepalive`, que sobrevive al cierre).
 * - Sin conexión, reintenta con espera creciente y sube apenas vuelve (`online`).
 * - Las pestañas del mismo navegador comparten UNA copia (la de `localStorage`): cada cambio
 *   se aplica sobre la más nueva, y el guardado va con un candado (`navigator.locks`) para
 *   que dos pestañas no manden lo mismo a la vez.
 */

export type SaveIndicator =
  | { kind: "saved"; at: string | null }
  | { kind: "saving" }
  | { kind: "offline" }
  | { kind: "error"; message: string };

const DEBOUNCE_MS = 1_500;

function readStorage(key: string): LocalDraft | null {
  try {
    return parseLocalDraft(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeStorage(key: string, local: LocalDraft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(local));
  } catch {
    // Sin localStorage (modo privado, cuota llena): sigue el guardado en el servidor.
  }
}

function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks ? (locks.request(name, fn) as Promise<T>) : fn();
}

export function useEodDraft(input: {
  workspaceId: string;
  userId: string;
  formId: string;
  reportDate: string;
  server: ServerDraft | null;
  /** Un reporte enviado en modo "uno por día": se muestra, no se guarda nada. */
  readOnly: boolean;
}) {
  const key = draftStorageKey(input.workspaceId, input.formId, input.userId, input.reportDate);
  const localRef = useRef<LocalDraft | null>(null);
  const [data, setData] = useState<EodDraftData>(() => input.server?.data ?? { answers: {}, channels: {} });
  const [indicator, setIndicator] = useState<SaveIndicator>({ kind: "saved", at: input.server?.savedAt ?? null });
  const [notice, setNotice] = useState<string | null>(null);
  const [baseRev, setBaseRev] = useState(input.server?.rev ?? 0);
  const timers = useRef<{ debounce?: number; retry?: number }>({});
  const attempt = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const inFlight = useRef(false);

  /** La copia más nueva: la de localStorage (la comparten las pestañas) o la de memoria. */
  const fresh = useCallback((): LocalDraft | null => readStorage(key) ?? localRef.current, [key]);

  const publish = useCallback(
    (local: LocalDraft, broadcast = true) => {
      localRef.current = local;
      writeStorage(key, local);
      setData(local.data);
      setBaseRev(local.baseRev);
      if (broadcast) {
        try {
          channel.current?.postMessage({ type: "changed" });
        } catch {
          // Otra pestaña se va a enterar al guardar o al recargar.
        }
      }
    },
    [key],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    if (input.readOnly) return true;
    window.clearTimeout(timers.current.debounce);
    if (inFlight.current) return false;
    inFlight.current = true;
    try {
      return await withLock(`eod-save:${key}`, async () => {
        const current = fresh();
        if (!current || !current.pending) {
          setIndicator((s) => (s.kind === "saving" ? { kind: "saved", at: current?.savedAt ?? null } : s));
          return true;
        }
        const { local: sending, payload } = beginSend(current);
        publish(sending, false);
        setIndicator({ kind: "saving" });
        let result: SaveDraftResult;
        try {
          result = await saveEodDraft({ formId: input.formId, reportDate: input.reportDate, rev: payload.rev, data: payload.data });
        } catch {
          // No llegó: sin conexión, o el servidor no respondió. Lo de acá sigue en localStorage.
          const delay = nextRetryDelay(attempt.current++);
          setIndicator(typeof navigator !== "undefined" && navigator.onLine === false ? { kind: "offline" } : { kind: "error", message: "No se pudo guardar" });
          timers.current.retry = window.setTimeout(() => void flush(), delay);
          return false;
        }
        const after = fresh() ?? sending;
        if (result.ok) {
          attempt.current = 0;
          const next = onSaveOk(after, payload.data, result.rev);
          publish(next);
          setIndicator({ kind: "saved", at: result.savedAt });
          if (next.pending) timers.current.debounce = window.setTimeout(() => void flush(), DEBOUNCE_MS);
          return !next.pending;
        }
        if (result.code === "conflict") {
          const next = onSaveConflict(after, result.current);
          publish(next);
          setNotice("Se actualizó con lo que cargaste en otra pestaña");
          // Lo fusionado se sube enseguida.
          timers.current.debounce = window.setTimeout(() => void flush(), 50);
          return false;
        }
        setIndicator({ kind: "error", message: result.error });
        if (result.code === "failed") {
          timers.current.retry = window.setTimeout(() => void flush(), nextRetryDelay(attempt.current++));
        }
        return false;
      });
    } finally {
      inFlight.current = false;
    }
  }, [fresh, input.formId, input.readOnly, input.reportDate, key, publish]);

  // Al abrir: el del servidor y el de este navegador, y gana el más nuevo (fusionando si hace falta).
  useEffect(() => {
    // Un reporte que solo se muestra (enviado, uno por día) se ve como está en el servidor.
    const merged = mergeDrafts(input.server, input.readOnly ? null : readStorage(key));
    const local = initialLocal(merged, new Date().toISOString());
    publish(local, false);
    if (merged.rebased) setNotice("Se actualizó con lo que cargaste en otra pestaña");
    if (merged.upload && !input.readOnly) {
      setIndicator({ kind: "saving" });
      void flush();
    }
    // Solo al abrir este reporte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Otras pestañas del mismo navegador: se actualizan solas.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(`eod:${key}`);
    channel.current = bc;
    bc.onmessage = () => {
      const stored = readStorage(key);
      if (stored) {
        localRef.current = stored;
        setData(stored.data);
        setBaseRev(stored.baseRev);
      }
    };
    return () => {
      bc.close();
      channel.current = null;
    };
  }, [key]);

  // Al volver la conexión, sube lo pendiente. Al ocultar o cerrar la pestaña, también.
  useEffect(() => {
    if (input.readOnly) return;
    const onOnline = () => {
      attempt.current = 0;
      void flush();
    };
    const sendKeepalive = () => {
      const current = fresh();
      if (!current?.pending) return;
      const { local: sending, payload } = beginSend(current);
      localRef.current = sending;
      writeStorage(key, sending);
      try {
        void fetch("/api/v1/eod/draft", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ formId: input.formId, reportDate: input.reportDate, rev: payload.rev, data: payload.data }),
          keepalive: true,
          credentials: "same-origin",
        })
          .then(async (res) => {
            const body = (await res.json().catch(() => null)) as SaveDraftResult | null;
            if (!body) return;
            const after = fresh() ?? sending;
            if (body.ok) publish(onSaveOk(after, payload.data, body.rev));
            else if (body.code === "conflict") publish(onSaveConflict(after, body.current));
          })
          .catch(() => undefined);
      } catch {
        // La copia de localStorage ya está escrita: se sube al volver a abrir.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") sendKeepalive();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", sendKeepalive);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", sendKeepalive);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush, fresh, input.formId, input.readOnly, input.reportDate, key, publish]);

  useEffect(() => {
    const t = timers.current;
    return () => {
      window.clearTimeout(t.debounce);
      window.clearTimeout(t.retry);
    };
  }, []);

  /**
   * Un cambio. `mutate` recibe el borrador MÁS NUEVO (el de localStorage, que comparten las
   * pestañas) y devuelve el nuevo: un "+1" se suma sobre lo último, nunca sobre lo que se ve.
   */
  const update = useCallback(
    (mutate: (draft: EodDraftData) => EodDraftData) => {
      if (input.readOnly) return;
      const current = fresh();
      if (!current) return;
      const next = applyLocalChange(current, mutate(current.data), new Date().toISOString());
      publish(next);
      setIndicator((s) => (s.kind === "offline" ? s : { kind: "saving" }));
      window.clearTimeout(timers.current.debounce);
      timers.current.debounce = window.setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush, fresh, input.readOnly, publish],
  );

  /** Después de enviar: el borrador de este navegador ya no hace falta. */
  const clearLocal = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nada que hacer.
    }
  }, [key]);

  return { data, update, flush, indicator, notice, dismissNotice: () => setNotice(null), baseRev: () => localRef.current?.baseRev ?? baseRev, pending: () => !!localRef.current?.pending, clearLocal };
}
