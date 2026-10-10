"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { countPendingDrafts, type PendingDraftCounts } from "@/lib/actions/agent-drafts";

/**
 * Los borradores esperando, al dia con Realtime sobre agent_drafts (Bloque 2c).
 *
 * Lo usan el badge de Inbox en el menu, la barra de arriba en el telefono y la
 * pestana "Borradores" de la bandeja (Bloque 2d): hasta cuatro a la vez.
 * Comparten UNA suscripcion y UNA consulta por workspace. Antes cada uno tenia
 * la suya, y cada cambio en un borrador disparaba cuatro veces la misma
 * accion de servidor; como las acciones de servidor corren de a una, esas
 * cuatro hacian esperar a cualquier guardado que viniera detras.
 *
 * El valor inicial lo calcula el servidor, para que el numero no arranque en
 * cero y salte un instante despues. `channelName` queda por compatibilidad: ya
 * no hace falta distinguir canales.
 */
export function useDraftCounts(
  workspaceId: string,
  initial: PendingDraftCounts | undefined,
  _channelName?: string,
): PendingDraftCounts | undefined {
  const [counts, setCounts] = useState<PendingDraftCounts | undefined>(initial);

  useEffect(() => {
    setCounts(initial);
  }, [initial]);

  useEffect(() => subscribeDraftCounts(workspaceId, setCounts), [workspaceId]);

  return counts;
}

type Listener = (counts: PendingDraftCounts) => void;

interface SharedSubscription {
  listeners: Set<Listener>;
  timer: ReturnType<typeof setTimeout> | null;
  stop: () => void;
}

const shared = new Map<string, SharedSubscription>();

/** Se suma a la suscripcion del workspace (o la crea) y devuelve como salir. */
function subscribeDraftCounts(workspaceId: string, listener: Listener): () => void {
  let sub = shared.get(workspaceId);
  if (!sub) {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    const created: SharedSubscription = {
      listeners: new Set(),
      timer: null,
      stop: () => {
        cancelled = true;
        if (created.timer) clearTimeout(created.timer);
        if (channel) supabase.removeChannel(channel);
      },
    };
    sub = created;
    (async () => {
      // Sin sesion el canal se suscribiria como anonimo y no llegaria nada.
      await supabase.auth.getSession();
      if (cancelled) return;
      channel = supabase
        .channel(`draft-counts-${workspaceId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "agent_drafts", filter: `workspace_id=eq.${workspaceId}` }, () => {
          if (created.timer) clearTimeout(created.timer);
          created.timer = setTimeout(async () => {
            try {
              const next = await countPendingDrafts();
              for (const l of created.listeners) l(next);
            } catch (err) {
              console.error("[borradores] no pude actualizar el contador:", err instanceof Error ? err.message : "error");
            }
          }, 800);
        })
        .subscribe();
    })();
    shared.set(workspaceId, sub);
  }
  sub.listeners.add(listener);
  const mine = sub;
  return () => {
    mine.listeners.delete(listener);
    if (mine.listeners.size === 0) {
      mine.stop();
      if (shared.get(workspaceId) === mine) shared.delete(workspaceId);
    }
  };
}

/**
 * El numero que se muestra: los mios para un Member; para Owner/Admin el
 * total del workspace (un Owner sin contactos propios no puede ver "0" con
 * doce esperando). 0 = no se muestra nada.
 */
export function visibleDraftCount(counts: PendingDraftCounts | undefined): number {
  if (!counts) return 0;
  return counts.total ?? counts.mine;
}
