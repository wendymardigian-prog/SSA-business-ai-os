"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadConversationDraft } from "@/lib/actions/agent-drafts";
import type { DraftQueueRow } from "@/lib/agent/drafts/queue-query";
import { ThreadDraft } from "@/components/drafts/draft-card";

/**
 * El borrador del agente en la conversacion (Bloque 2c), arriba del campo de
 * escritura. Con borde punteado y el rotulo "no enviado": nunca con el aspecto
 * de un mensaje enviado.
 *
 * Se carga con el cliente del usuario (la RLS acota al scope de leads) y se
 * mantiene al dia con Realtime sobre los borradores de esta conversacion.
 */
export function PendingDraft({ conversationId }: { conversationId: string }) {
  const [draft, setDraft] = useState<DraftQueueRow | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      setDraft(await loadConversationDraft(conversationId));
    } catch (err) {
      console.error("[inbox] no pude leer el borrador:", err instanceof Error ? err.message : "error");
    }
  }, [conversationId]);

  useEffect(() => {
    setDraft(null);
    reload();
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      await supabase.auth.getSession();
      if (cancelled) return;
      channel = supabase
        .channel(`conversation-draft-${conversationId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "agent_drafts", filter: `conversation_id=eq.${conversationId}` },
          () => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(reload, 500);
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [conversationId, reload]);

  if (!draft) return null;
  return (
    <div className="border-t border-border px-4 pt-3">
      <ThreadDraft key={draft.id} draft={draft} onDone={reload} />
    </div>
  );
}
