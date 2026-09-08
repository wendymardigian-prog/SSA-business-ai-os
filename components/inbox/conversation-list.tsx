"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Ban, ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { InboxFiltersBar } from "@/components/inbox/inbox-filters";
import {
  matchesInboxRow,
  needsServerToFilter,
  countActiveFilters,
  type InboxFilters,
} from "@/lib/inbox/filters";
import type { DateRange } from "@/lib/dates";
import type { Database } from "@/lib/types/database";
import type { ConversationRow } from "@/lib/inbox/types";

type Conversation = ConversationRow;

/** Cuanto se espera antes de volver a preguntarle al servidor (ver abajo). */
const REFRESH_DEBOUNCE_MS = 800;

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) {
    return date.toLocaleDateString("es-AR", { weekday: "short" });
  }
  return date.toLocaleDateString("es-AR", { month: "short", day: "numeric" });
}

export function ConversationList({
  conversations: initialConversations,
  workspaceId,
  selectedId,
  onSelect,
  filters,
  dateRange,
  tags,
  platforms,
  members,
  total,
  page,
  pageSize,
  onPageChange,
}: {
  conversations: Conversation[];
  workspaceId: string;
  selectedId: string | null;
  onSelect: (conversation: Conversation) => void;
  filters: InboxFilters;
  dateRange: DateRange;
  tags: { id: string; name: string; color: string | null }[];
  platforms: { value: string; label: string }[];
  members: { userId: string; label: string }[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  // Relative timestamps depend on the client's clock/locale, which differ from the
  // server's during SSR and trigger a hydration mismatch (React #418, which crashes
  // the inbox in production). Defer time rendering until after mount so the server
  // and the first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setConversations(initialConversations);
  }, [initialConversations]);

  /**
   * Realtime, ahora que los filtros y la paginacion los resuelve el servidor.
   *
   * Antes esto agregaba cualquier conversacion nueva del workspace al principio
   * de la lista sin mirar el filtro, y nunca sacaba una que dejara de
   * cumplirlo. Con filtros de verdad eso se vuelve visible enseguida.
   *
   * La regla ahora es: si el cambio es sobre una fila que ya esta en pantalla y
   * sigue entrando en lo que se esta mirando, se actualiza en el acto (es lo
   * que hace que un mensaje nuevo mueva la conversacion arriba al instante).
   * Cualquier otra cosa — una fila que entra, una que sale, o filtros que
   * dependen de datos que la fila no trae — se le vuelve a preguntar al
   * servidor, que es el unico que sabe la respuesta con la paginacion puesta.
   *
   * El refresh va con un respiro de por medio: una rafaga de mensajes dispara
   * un evento por cada uno y no hace falta rehacer la consulta cinco veces.
   */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const serverOnly = needsServerToFilter(filters);

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel("conversations-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          if (payload.eventType !== "UPDATE") {
            scheduleRefresh();
            return;
          }

          const updated = payload.new as Database["public"]["Tables"]["conversations"]["Row"];

          setConversations((prev) => {
            const current = prev.find((c) => c.id === updated.id);
            if (!current) {
              // No estaba en pantalla: puede que ahora corresponda mostrarla.
              scheduleRefresh();
              return prev;
            }

            const merged = { ...current, ...updated };

            if (serverOnly || !matchesInboxRow(merged, filters, dateRange)) {
              scheduleRefresh();
              return prev;
            }

            return prev
              .map((c) => (c.id === updated.id ? merged : c))
              .sort((a, b) => {
                const aTime = a.last_message_at ?? a.created_at;
                const bTime = b.last_message_at ?? b.created_at;
                return new Date(bTime).getTime() - new Date(aTime).getTime();
              });
          });
        },
      )
      .subscribe();

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [workspaceId, filters, dateRange, router]);

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = countActiveFilters(filters) > 0;

  return (
    <div className="flex h-full flex-col border-r border-border bg-background">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">Bandeja</h2>
        <span className="text-xs text-muted-foreground">
          {total === 1 ? "1 conversación" : `${total} conversaciones`}
        </span>
      </div>

      <InboxFiltersBar
        filters={filters}
        tags={tags}
        platforms={platforms}
        members={members}
      />

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          /* Dos vacios distintos: "todavia no pasó nada" y "tu filtro no
             encontró nada" piden cosas opuestas de quien mira la pantalla. */
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            {hasFilters ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ninguna conversación coincide con los filtros
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Probá quitando alguno para ver más.
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">Todavía no hay conversaciones</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Cuando alguien escriba por un canal conectado, va a aparecer acá.
                </p>
              </>
            )}
          </div>
        ) : (
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => onSelect(conversation)}
              className={cn(
                "flex w-full items-start gap-3 border-b border-border p-3 text-left transition-colors hover:bg-accent/50",
                selectedId === conversation.id && "bg-accent"
              )}
            >
              {/* Avatar with platform badge */}
              <div className="relative flex-shrink-0">
                {conversation.contacts?.avatar_url ? (
                  <img
                    src={conversation.contacts.avatar_url}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {conversation.contacts?.display_name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 border-background bg-background">
                  <PlatformIcon
                    platform={conversation.platform}
                    className="h-3 w-3"
                    size={12}
                  />
                </div>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">
                      {conversation.contacts?.display_name ?? "Sin nombre"}
                    </span>
                    {/* F18: el aviso tiene que estar donde se elige a quien
                        contestarle, no solo adentro de la ficha. */}
                    {conversation.contacts?.do_not_contact && (
                      <Ban
                        className="h-3.5 w-3.5 flex-shrink-0 text-red-600 dark:text-red-400"
                        aria-label="No contactar"
                      />
                    )}
                  </p>
                  <span
                    suppressHydrationWarning
                    className="flex-shrink-0 text-[11px] text-muted-foreground"
                  >
                    {mounted ? formatTime(conversation.last_message_at) : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {conversation.last_message_preview ?? "Sin mensajes todavía"}
                  </p>
                  {conversation.unread_count > 0 && (
                    <span className="ml-2 flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {conversation.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {lastPage > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <span className="text-xs text-muted-foreground">
            Página {page} de {lastPage}
          </span>
          <div className="flex gap-1">
            <PageButton
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              label="Anterior"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </PageButton>
            <PageButton
              disabled={page >= lastPage}
              onClick={() => onPageChange(page + 1)}
              label="Siguiente"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </PageButton>
          </div>
        </div>
      )}
    </div>
  );
}

function PageButton({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
