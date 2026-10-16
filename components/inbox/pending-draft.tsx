"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadConversationDiscardedDraft, loadConversationDraft } from "@/lib/actions/agent-drafts";
import type { DraftQueueRow } from "@/lib/agent/drafts/queue-query";
import { DiscardedSuggestion, ThreadDraft, discardedAgo } from "@/components/drafts/draft-card";

/**
 * El borrador del agente en la conversacion (Bloque 2c), arriba del campo de
 * escritura. Con borde punteado y el rotulo "no enviado": nunca con el aspecto
 * de un mensaje enviado.
 *
 * Sin borrador vivo, si una persona descarto una sugerencia y todavia se puede
 * recuperar (A1), se ofrece una linea discreta "Sugerencia descartada · Ver":
 * abre la sugerencia con el rotulo "descartada" y un boton para copiarla al
 * campo de escritura.
 *
 * Se carga con el cliente del usuario (la RLS acota al scope de leads) y se
 * mantiene al dia con Realtime sobre los borradores de esta conversacion.
 */
export function PendingDraft({
  conversationId,
  onRecover,
  onLiveChange,
}: {
  conversationId: string;
  /** Copia el texto de una sugerencia descartada al campo de escritura. */
  onRecover?: (body: string) => void;
  /** Avisa si hay un borrador vivo (para que el boton "Sugerir respuesta" lo sepa). */
  onLiveChange?: (hasLiveDraft: boolean) => void;
}) {
  const [draft, setDraft] = useState<DraftQueueRow | null>(null);
  const [discarded, setDiscarded] = useState<DraftQueueRow | null>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLiveChangeRef = useRef(onLiveChange);
  useEffect(() => {
    onLiveChangeRef.current = onLiveChange;
  });

  const reload = useCallback(async () => {
    try {
      const live = await loadConversationDraft(conversationId);
      setDraft(live);
      // La descartada solo se mira si no hay un borrador vivo.
      setDiscarded(live ? null : await loadConversationDiscardedDraft(conversationId));
    } catch (err) {
      console.error("[inbox] no pude leer el borrador:", err instanceof Error ? err.message : "error");
    }
  }, [conversationId]);

  useEffect(() => {
    onLiveChangeRef.current?.(draft !== null);
  }, [draft]);

  // Montado con key={conversationId}: cambiar de conversacion arranca de cero.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      await supabase.auth.getSession();
      if (cancelled) return;
      await reload();
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

  if (draft) {
    return (
      <div className="border-t border-border px-3 pt-3 md:px-4">
        <ThreadDraft key={draft.id} draft={draft} onDone={reload} />
      </div>
    );
  }

  if (discarded && onRecover) {
    return (
      <div className="border-t border-border px-3 pt-2 md:px-4">
        {showDiscarded ? (
          <DiscardedSuggestion
            draft={discarded}
            onRecover={(body) => {
              onRecover(body);
              setShowDiscarded(false);
            }}
            onClose={() => setShowDiscarded(false)}
          />
        ) : (
          <div className="mx-auto flex max-w-2xl items-center gap-2 text-xs text-muted-foreground">
            <span>Sugerencia descartada · {discardedAgo(discarded)}</span>
            <button
              type="button"
              onClick={() => setShowDiscarded(true)}
              className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
            >
              Ver
            </button>
          </div>
        )}
      </div>
    );
  }
  return null;
}
