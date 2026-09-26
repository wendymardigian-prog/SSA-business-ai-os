"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { countPendingDrafts, type PendingDraftCounts } from "@/lib/actions/agent-drafts";

/**
 * Los borradores esperando, al dia con Realtime sobre agent_drafts (Bloque 2c).
 *
 * Lo usan el badge de Inbox en el menu, la barra de arriba en el telefono y la
 * pestana "Borradores" de la bandeja (Bloque 2d). Cada uno se suscribe por su
 * cuenta: son pocos eventos y el nombre del canal distingue a cada uno.
 *
 * El valor inicial lo calcula el servidor, para que el numero no arranque en
 * cero y salte un instante despues.
 */
export function useDraftCounts(
  workspaceId: string,
  initial: PendingDraftCounts | undefined,
  channelName: string,
): PendingDraftCounts | undefined {
  const [counts, setCounts] = useState<PendingDraftCounts | undefined>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCounts(initial);
  }, [initial]);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      // Sin sesion el canal se suscribiria como anonimo y no llegaria nada.
      await supabase.auth.getSession();
      if (cancelled) return;
      channel = supabase
        .channel(`${channelName}-${workspaceId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "agent_drafts", filter: `workspace_id=eq.${workspaceId}` }, () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(async () => {
            try {
              setCounts(await countPendingDrafts());
            } catch (err) {
              console.error("[borradores] no pude actualizar el contador:", err instanceof Error ? err.message : "error");
            }
          }, 800);
        })
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [workspaceId, channelName]);

  return counts;
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
