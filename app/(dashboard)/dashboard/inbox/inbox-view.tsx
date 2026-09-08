"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { MessageSquare, RefreshCw, User } from "lucide-react";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactPanel } from "@/components/inbox/contact-panel";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/types/database";
import type { ConversationRow } from "@/lib/inbox/types";
import type { SearchableTemplate } from "@/lib/templates/search";
import { countActiveFilters, type InboxFilters } from "@/lib/inbox/filters";
import type { DateRange } from "@/lib/dates";

type Conversation = ConversationRow;
type Message = Database["public"]["Tables"]["messages"]["Row"];

export function InboxView({
  conversations,
  workspaceId,
  templates,
  workspaceName,
  selected,
  total,
  page,
  pageSize,
  filters,
  dateRange,
  tags,
  platforms,
  members,
}: {
  conversations: Conversation[];
  workspaceId: string;
  /** Respuestas rapidas del workspace, para el selector "/" del composer (F17). */
  templates: SearchableTemplate[];
  workspaceName: string;
  /** La conversacion abierta, resuelta en el servidor desde ?c= (F16). */
  selected: Conversation | null;
  total: number;
  page: number;
  pageSize: number;
  filters: InboxFilters;
  dateRange: DateRange;
  tags: { id: string; name: string; color: string | null }[];
  platforms: { value: string; label: string }[];
  members: { userId: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showContactPanel, setShowContactPanel] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Imports conversations that already exist in Zernio (e.g. from before the
  // webhook was registered), then refreshes the server-rendered list.
  async function handleSyncConversations() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/v1/channels/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        setSyncError(data.error || "Sync failed");
        return;
      }
      router.refresh();
    } catch {
      setSyncError("Failed to sync. Check your connection.");
    } finally {
      setSyncing(false);
    }
  }

  const hasFilters = countActiveFilters(filters) > 0;

  function goToPage(next: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (next <= 1) params.delete("page");
    else params.set("page", String(next));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  /**
   * Abrir una conversacion cambia la URL en vez de guardar la fila en un
   * estado local. Asi el hilo sobrevive a un refresh, el link se puede
   * compartir, y la conversacion que se muestra es siempre la que el servidor
   * acaba de traer (antes era una copia congelada al momento del clic, y
   * despues de un cambio por realtime el encabezado mostraba datos viejos).
   */
  const handleSelect = useCallback(
    (c: Conversation) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("c", c.id);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Load messages when a conversation is selected
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }

    async function loadMessages() {
      setLoadingMessages(true);
      try {
        const res = await fetch(
          `/api/v1/messages?conversationId=${selected!.id}`
        );
        if (res.ok) {
          const data = await res.json();
          setMessages(data ?? []);
        } else {
          console.error("Failed to load messages:", res.status);
          setMessages([]);
        }
      } catch (err) {
        console.error("Failed to load messages:", err);
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }

      // Mark as read
      if (selected!.unread_count > 0) {
        const supabase = createClient();
        await supabase
          .from("conversations")
          .update({ unread_count: 0 })
          .eq("id", selected!.id);
      }
    }

    loadMessages();
  }, [selected?.id]);

  return (
    <div className="flex h-full">
      {/* Left panel: Conversation list */}
      <div className="w-80 flex-shrink-0">
        <ConversationList
          conversations={conversations}
          workspaceId={workspaceId}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
          filters={filters}
          dateRange={dateRange}
          tags={tags}
          platforms={platforms}
          members={members}
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={goToPage}
        />
      </div>

      {/* Center panel: Message thread */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Toggle contact panel button */}
        {selected && !showContactPanel && (
          <div className="flex shrink-0 justify-end border-b border-border px-2 py-1">
            <button
              onClick={() => setShowContactPanel(true)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Ver datos del contacto"
            >
              <User className="h-3.5 w-3.5" />
              Datos del contacto
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {/* El CTA de sincronizar es para una bandeja que nunca recibio nada.
              Una bandeja vacia porque el filtro no encontro nada es otra cosa:
              ahi el aviso lo da la lista de la izquierda y ofrecer "traer
              conversaciones de Zernio" solo confunde. */}
          {conversations.length === 0 && !hasFilters ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                Todavía no hay conversaciones
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground/70">
                Si ya tenés conversaciones en Zernio, traelas para verlas acá.
              </p>
              <button
                onClick={handleSyncConversations}
                disabled={syncing}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                {syncing ? "Trayendo..." : "Traer conversaciones"}
              </button>
              {syncError && (
                <p className="mt-2 text-xs text-destructive">{syncError}</p>
              )}
            </div>
          ) : loadingMessages && selected ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          ) : (
            <MessageThread
              conversation={selected}
              messages={messages}
              templates={templates}
              workspaceName={workspaceName}
            />
          )}
        </div>
      </div>

      {/* Right panel: Contact info */}
      {showContactPanel && selected?.contact_id && (
        <ContactPanel
          contactId={selected.contact_id}
          workspaceId={workspaceId}
          onClose={() => setShowContactPanel(false)}
        />
      )}
    </div>
  );
}
