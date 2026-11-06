"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** El mismo respiro que la lista de conversaciones: una rafaga de mensajes en un grupo no rehace la pagina cinco veces. */
const REFRESH_DEBOUNCE_MS = 800;

/** La lista muestra grupos: cuando cambia alguno (un mensaje nuevo, un no leido) vuelve a pedir la pagina. */
export function useGroupListRealtime(workspaceId: string, enabled: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("whatsapp-groups-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_groups", filter: `workspace_id=eq.${workspaceId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [workspaceId, enabled, router]);
}
