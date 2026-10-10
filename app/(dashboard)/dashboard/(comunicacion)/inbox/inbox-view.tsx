"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { MessageSquare, RefreshCw, User } from "lucide-react";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread, type InboxAsset } from "@/components/inbox/message-thread";
import { ContactPanel } from "@/components/inbox/contact-panel";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/types/database";
import type { ConversationRow } from "@/lib/inbox/types";
import { countActiveFilters, type InboxFilters } from "@/lib/inbox/filters";
import type { DateRange } from "@/lib/dates";
import type { ChannelAgentInfo } from "@/lib/agent/public";
import type { PendingDraftCounts } from "@/lib/actions/agent-drafts";

type Conversation = ConversationRow;
type Message = Database["public"]["Tables"]["messages"]["Row"];

export function InboxView({
  conversations,
  workspaceId,
  assets,
  canManageAssets = false,
  workspaceName,
  selected: selectedFromServer,
  total,
  page,
  pageSize,
  filters,
  dateRange,
  tags,
  members,
  agentByChannel,
  providerByChannel,
  currentUserId,
  isAdmin,
  draftCounts,
  draftConversationIds = [],
}: {
  conversations: Conversation[];
  workspaceId: string;
  /** La banca de recursos del workspace (los seis tipos), para el widget del composer. */
  assets: InboxAsset[];
  /** Puede crear recursos (`templates.manage`): el widget vacio le ofrece crear el primero. */
  canManageAssets?: boolean;
  workspaceName: string;
  /**
   * La conversacion de ?c= resuelta en el servidor al cargar la pagina (F16).
   * Hace falta solo para un link a una conversacion que no esta en la pagina
   * de la lista; la que se muestra se decide abajo, en el navegador.
   */
  selected: Conversation | null;
  total: number;
  page: number;
  pageSize: number;
  filters: InboxFilters;
  dateRange: DateRange;
  tags: { id: string; name: string; color: string | null; disablesAgent?: boolean; assignsTo?: string | null }[];
  members: { userId: string; label: string }[];
  /** Por canal: si el agente de IA lo atiende y por que no (Fase 3). */
  agentByChannel: Record<string, ChannelAgentInfo>;
  /** Por canal: su `provider` (evolution/zernio/resend), para saber que tipos de recurso se pueden mandar. */
  providerByChannel: Record<string, string>;
  /** Para el panel del contacto (Bloque 2c): editar setter y vendedor. */
  currentUserId: string;
  isAdmin: boolean;
  /** Borradores esperando, para la pestana "Borradores (N)" (Bloque 2d). */
  draftCounts?: PendingDraftCounts;
  /** Las conversaciones de la pagina con un borrador vivo: llevan un chip. */
  draftConversationIds?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showContactPanel, setShowContactPanel] = useState(true);
  // En el telefono el panel del contacto es una hoja que se abre a pedido:
  // abierto por defecto taparia el hilo entero.
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
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
   * estado local. Asi el hilo sobrevive a un refresh y el link se puede
   * compartir.
   *
   * Pero NO va al servidor: la fila ya esta en `conversations`, que es lo que
   * el servidor acaba de traer (y que el realtime refresca), asi que la que se
   * muestra nunca es una copia congelada. Antes cada clic volvia a correr la
   * pagina entera de la bandeja (filtros, miembros, agentes, la banca de
   * recursos, borradores...) para pintar el mismo listado con otra fila
   * marcada. `replaceState` actualiza la URL y Next mantiene
   * `useSearchParams` al dia.
   */
  const selectedId = searchParams.get("c");
  const selected = selectedId
    ? (conversations.find((c) => c.id === selectedId) ?? (selectedFromServer?.id === selectedId ? selectedFromServer : null))
    : null;

  const replaceQuery = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}`);
    },
    [pathname],
  );

  const handleSelect = useCallback(
    (c: Conversation) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("c", c.id);
      replaceQuery(next);
    },
    [replaceQuery, searchParams],
  );

  /** Telefono: volver del hilo a la lista (saca ?c= de la URL). */
  const handleBack = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("c");
    setContactSheetOpen(false);
    replaceQuery(next);
  }, [replaceQuery, searchParams]);

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
    // En el telefono (Bloque 2d) es lista -> hilo a pantalla completa: con una
    // conversacion abierta se ve el hilo, sin ninguna se ve la lista.
    <div className="flex h-full">
      {/* Left panel: Conversation list */}
      <div className={cn("w-full flex-shrink-0 md:block md:w-80", selected ? "hidden" : "block")}>
        <ConversationList
          conversations={conversations}
          workspaceId={workspaceId}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
          filters={filters}
          dateRange={dateRange}
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={goToPage}
          draftCounts={draftCounts}
          draftConversationIds={draftConversationIds}
        />
      </div>

      {/* Center panel: Message thread */}
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", selected ? "flex" : "hidden")}>
        {/* Toggle contact panel button */}
        {selected && !showContactPanel && (
          <div className="hidden shrink-0 justify-end border-b border-border px-2 py-1 md:flex">
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
              assets={assets}
              canManageAssets={canManageAssets}
              workspaceName={workspaceName}
              agentInfo={selected ? agentByChannel[selected.channel_id] ?? null : null}
              channelProvider={selected ? providerByChannel[selected.channel_id] ?? null : null}
              onBack={selected ? handleBack : undefined}
              onOpenContact={selected?.contact_id ? () => setContactSheetOpen(true) : undefined}
            />
          )}
        </div>
      </div>

      {/* Right panel: Contact info. En la computadora es la tercera columna; en
          el telefono, una hoja a pantalla completa que se abre a pedido. Una
          sola instancia, para no cargar el contacto dos veces. */}
      {selected?.contact_id && (showContactPanel || contactSheetOpen) && (
        <div
          className={cn(
            contactSheetOpen ? "fixed inset-0 z-40 flex bg-background" : "hidden",
            showContactPanel ? "md:static md:z-auto md:flex" : "md:hidden",
          )}
        >
          <ContactPanel
            contactId={selected.contact_id}
            workspaceId={workspaceId}
            onClose={() => (contactSheetOpen ? setContactSheetOpen(false) : setShowContactPanel(false))}
            members={members}
            allTags={tags}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
          />
        </div>
      )}
    </div>
  );
}
