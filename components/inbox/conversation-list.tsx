"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Ban, CheckCheck, FileText, Loader2, Megaphone, UserRoundSearch, Users, UsersRound, X } from "lucide-react";
import { groupDisplayName } from "@/lib/whatsapp-groups/settings";
import { needsHumanBadge } from "@/lib/inbox/needs-human";
import { noReplyBadge } from "@/lib/inbox/awaiting";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { UnidentifiedNotice } from "@/components/inbox/inbox-filters";
import { InboxListHeader } from "@/components/inbox/inbox-list-header";
import {
  showsOnlyGroups,
  countActiveFilters,
  type InboxFilters,
} from "@/lib/inbox/filters";
import type { DateRange } from "@/lib/dates";
import type { ConversationRow } from "@/lib/inbox/types";
import type { FilterSummaryCatalog } from "@/lib/inbox/filter-summary";
import { groupsForLoaded, mergeInboxRows } from "@/lib/inbox/unified-list";
import type { ListCursor } from "@/lib/inbox/list-cursor";
import { useInboxList } from "@/components/inbox/use-inbox-list";
import type { GroupListRow } from "@/lib/whatsapp-groups/thread";
import { accountToShow, type InboxAccountsInfo } from "@/lib/inbox/accounts";
import { assigneeName } from "@/lib/inbox/assignee";
import { knownLabel } from "@/lib/inbox/known";
import { contactMarks, customerLabel } from "@/lib/inbox/marks";
import { planRowActions, type RowAction } from "@/lib/inbox/row-actions";
import { setCustomer, setKnown } from "@/lib/actions/contacts";
import { MarkBadge } from "@/components/contacts/mark-badge";
import { ConversationRowMenu } from "@/components/inbox/conversation-row-menu";
import { DeleteDialog } from "@/components/trash/delete-dialog";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Tip } from "@/components/ui/tooltip";
import { conversationListPreview, EMPTY_PREVIEW } from "@/lib/inbox/last-message";
import { listTimeLabel } from "@/lib/inbox/day-label";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import type { PendingDraftCounts } from "@/lib/agent/drafts/pending-count";

type Conversation = ConversationRow;

function formatTime(dateStr: string | null, timeZone: string): string {
  if (!dateStr) return "";
  // Por dia de calendario (lib/inbox/day-label.ts): un mensaje de ayer a la
  // noche dice "Ayer" aunque no hayan pasado 24 horas.
  return listTimeLabel(new Date(dateStr), timeZone);
}

export function ConversationList({
  conversations: initialConversations,
  workspaceId,
  selectedId,
  onSelect,
  filters,
  dateRange,
  total: initialTotal,
  listQuery,
  initialCursor = null,
  initialHasMore = false,
  draftCounts,
  draftConversationIds = [],
  accounts,
  members = [],
  currentUserId = "",
  canEditContacts = false,
  canDeleteContacts = false,
  canDeleteConversations = false,
  onConversationDeleted,
  hasGroups = false,
  unidentifiedCount = 0,
  groups = [],
  groupsTotal = 0,
  selectedGroupId = null,
  onSelectGroup,
  canManageGroups = false,
  filterCatalog,
  tags = [],
}: {
  conversations: Conversation[];
  workspaceId: string;
  selectedId: string | null;
  onSelect: (conversation: Conversation) => void;
  filters: InboxFilters;
  dateRange: DateRange;
  /** Cuantos chats cumplen los filtros al cargar la pagina; despues lo ajusta el tiempo real. */
  total: number;
  /** La parte de la URL con los filtros (`listQueryOf`): viaja al pedir mas chats o los que cambiaron en vivo. */
  listQuery: string;
  /** Donde arranca la segunda tanda (scroll infinito). */
  initialCursor?: ListCursor | null;
  initialHasMore?: boolean;
  /** Borradores esperando: la pestana "Borradores (N)" (Bloque 2d). */
  draftCounts?: PendingDraftCounts;
  /** Conversaciones de la primera tanda con un borrador vivo del agente. */
  draftConversationIds?: string[];
  /** Las cuentas por canal: la lista dice de cual es cada conversacion cuando una red tiene varias. */
  accounts?: InboxAccountsInfo;
  /** El equipo: el circulo del responsable de cada conversacion (00255). */
  members?: { userId: string; label: string }[];
  /** Para el "⋯" de cada fila: marcar conocido o cliente sin abrir el chat. */
  currentUserId?: string;
  canEditContacts?: boolean;
  canDeleteContacts?: boolean;
  /** `conversations.delete`: «Eliminar conversación» en el "⋯" de cada fila (la Papelera). */
  canDeleteConversations?: boolean;
  /** Una conversación se mandó a la Papelera: la vista saca `?c=` si era la abierta. */
  onConversationDeleted?: (conversationId: string) => void;
  /** Hay grupos de WhatsApp activados que esta persona ve (00280): los filtros ofrecen elegir entre chats y grupos. */
  hasGroups?: boolean;
  /** Chats que la lista oculta por defecto (00296). */
  unidentifiedCount?: number;
  /** Todos los grupos que cumplen los filtros: se intercalan con los chats por fecha a medida que se baja. */
  groups?: GroupListRow[];
  /** Cuantos grupos cumplen los filtros. */
  groupsTotal?: number;
  selectedGroupId?: string | null;
  onSelectGroup?: (groupId: string) => void;
  /** `channels.manage`: el vacio de los grupos lleva a donde se activan. */
  canManageGroups?: boolean;
  filterCatalog?: FilterSummaryCatalog;
  tags?: { id: string; name: string; color: string | null }[];
}) {
  const router = useRouter();
  // De a tandas al bajar y al dia en vivo (components/inbox/use-inbox-list.ts).
  const initial = useMemo(
    () => ({ rows: initialConversations, cursor: initialCursor, hasMore: initialHasMore, total: initialTotal, draftConversationIds }),
    [initialConversations, initialCursor, initialHasMore, initialTotal, draftConversationIds],
  );
  const {
    rows: conversations,
    hasMore,
    total,
    drafts,
    setRows: setConversations,
    loadMore,
    loadingMore,
    loadError,
  } = useInboxList({ initial, listQuery, filters, dateRange, workspaceId });
  // El "⋯" de una fila: que fila esta guardando y el ultimo error.
  const [rowPending, setRowPending] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  // La conversación que se está por mandar a la Papelera (el diálogo de «Eliminar»).
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function runRowAction(conversation: Conversation, action: Exclude<RowAction, "openContact">) {
    if (action === "deleteConversation") {
      setDeletingId(conversation.id);
      return;
    }
    const contactId = conversation.contact_id;
    if (!contactId) return;
    setRowPending(conversation.id);
    setRowError(null);
    try {
      const value = action === "markKnown" || action === "markCustomer";
      const isKnownAction = action === "markKnown" || action === "unmarkKnown";
      const result = isKnownAction ? await setKnown(contactId, value) : await setCustomer(contactId, value);
      if (!result.ok) {
        setRowError(result.error);
        return;
      }
      // Al instante en todas las filas del mismo contacto; el servidor confirma con el refresh.
      const patch = isKnownAction
        ? { is_known: value, known_marked_by: value ? currentUserId : null }
        : { is_customer: value, customer_marked_by: value ? currentUserId : null, customer_source: value ? "manual" : null };
      setConversations((prev) =>
        prev.map((c) => (c.contact_id === contactId && c.contacts ? { ...c, contacts: { ...c.contacts, ...patch } } : c)),
      );
      router.refresh();
    } finally {
      setRowPending(null);
    }
  }
  // "Hoy" y "Ayer" dependen del reloj, que puede cambiar de dia entre el render del
  // servidor y el del navegador (React #418, que tumba la bandeja en produccion).
  // La zona ya no es parte del problema: es la de quien mira en los dos lados.
  const timeZone = useViewerTimezone();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Scroll infinito: cuando el final de la lista se acerca a la vista, la tanda siguiente.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loadError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: scrollRef.current, rootMargin: "400px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadError, loadMore, conversations.length]);

  const withDraft = drafts;
  const hasFilters = countActiveFilters(filters) > 0;
  const lastLoaded = conversations.length > 0 ? conversations[conversations.length - 1].last_message_at : undefined;
  const items = mergeInboxRows(conversations, groupsForLoaded(groups, lastLoaded, hasMore));
  const shownTotal = total + groupsTotal;
  const countLabel =
    showsOnlyGroups(filters)
      ? shownTotal === 1 ? "1 grupo" : `${shownTotal} grupos`
      : shownTotal === 1 ? "1 chat" : `${shownTotal} chats`;

  return (
    <div className="flex h-full flex-col border-r border-border bg-background">
      <InboxListHeader
        filters={filters}
        countLabel={countLabel}
        workspaceId={workspaceId}
        draftCounts={draftCounts}
        accounts={filterCatalog?.accounts ?? []}
        tags={tags}
        members={members}
        hasGroups={hasGroups}
        catalog={filterCatalog ?? { platforms: [], tags: [], members: [] }}
      />

      {rowError && (
        <div role="alert" className="flex items-start gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <span className="flex-1">{rowError}</span>
          <button type="button" onClick={() => setRowError(null)} aria-label="Cerrar el aviso" className="rounded p-0.5 hover:bg-red-500/20">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {deletingId && (
        <DeleteDialog
          entity="conversation"
          id={deletingId}
          onClose={() => setDeletingId(null)}
          onDeleted={() => {
            const id = deletingId;
            // Sale de la lista al instante; el servidor confirma con el refresh que hace el diálogo.
            setConversations((prev) => prev.filter((c) => c.id !== id));
            onConversationDeleted?.(id);
          }}
        />
      )}

      {!filters.onlyUnidentified && !showsOnlyGroups(filters) && <UnidentifiedNotice count={unidentifiedCount} />}

      {/* Conversation list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {items.length === 0 && !hasMore ? (
          /* Dos vacios distintos: "todavia no pasó nada" y "tu filtro no
             encontró nada" piden cosas opuestas de quien mira la pantalla. */
          filters.listType === "grupos" && !hasGroups ? (
            <NoGroupsYet canManageGroups={canManageGroups} />
          ) : (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground" />
            {hasFilters ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ninguna conversación coincide con los filtros
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Probá quitando alguno para ver más.
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">Todavía no hay conversaciones</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cuando alguien escriba por un canal conectado, va a aparecer acá.
                </p>
              </>
            )}
          </div>
          )
        ) : (
          items.map((item) => {
            if (item.kind === "group") {
              return (
                <GroupRow
                  key={`g-${item.row.id}`}
                  group={item.row}
                  selected={selectedGroupId === item.row.id}
                  account={accountToShow(accounts, { channel_id: item.row.channelId, platform: "whatsapp" })}
                  time={mounted ? formatTime(item.row.lastMessageAt, timeZone) : ""}
                  onSelect={() => onSelectGroup?.(item.row.id)}
                />
              );
            }
            const conversation = item.row;
            return (
            <div key={conversation.id} className="relative">
            {/* Fase 3: el agente fallo en esta conversacion. Un punto discreto que
                lleva al run; nunca nada visible para el lead. Va afuera del
                boton de la fila porque un link no puede ir adentro de un boton. */}
            {conversation.last_agent_error_at && (
              <Tip asChild content="El agente de IA no pudo responder en esta conversación. Ver el run.">
                <Link
                  href={conversation.last_agent_error_run_id ? `/dashboard/agents/runs/${conversation.last_agent_error_run_id}` : "/dashboard/agents"}
                  aria-label="El agente de IA no pudo responder. Ver el run que falló"
                  className="absolute left-2 top-2 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background" />
                </Link>
              </Tip>
            )}
            {/* El "⋯" de la fila: marcar conocido o cliente sin abrir el chat. Va
                afuera del boton de la fila (un boton no puede ir adentro de otro). */}
            <div className="absolute right-1 top-1/2 z-10 -translate-y-1/2">
              <ConversationRowMenu
                actions={planRowActions({
                  contactId: conversation.contact_id,
                  contact: conversation.contacts,
                  viewerId: currentUserId,
                  canEditContacts,
                  canDeleteContacts,
                  canDeleteConversation: canDeleteConversations,
                })}
                contactId={conversation.contact_id}
                contactName={conversation.contacts?.display_name ?? "este contacto"}
                pending={rowPending === conversation.id}
                onAction={(action) => void runRowAction(conversation, action)}
              />
            </div>
            <button
              onClick={() => onSelect(conversation)}
              className={cn(
                "flex w-full items-start gap-3 border-b border-border py-3 pl-3 pr-9 text-left transition-colors hover:bg-accent/50",
                selectedId === conversation.id && "bg-accent"
              )}
            >
              {/* Avatar with platform badge */}
              <div className="relative flex-shrink-0">
                <ContactAvatar avatarUrl={conversation.contacts?.avatar_url} displayName={conversation.contacts?.display_name} />
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
                    {/* Conocido (00256) y Cliente (00268): que el equipo lo reconozca sin abrirlo. */}
                    {contactMarks(conversation.contacts).map((mark) => (
                      <MarkBadge
                        key={mark}
                        mark={mark}
                        size="xs"
                        iconOnly
                        title={
                          mark === "known"
                            ? knownLabel(assigneeName(members, conversation.contacts?.known_marked_by ?? null))
                            : customerLabel(
                                assigneeName(members, conversation.contacts?.customer_marked_by ?? null),
                                conversation.contacts?.customer_source,
                              )
                        }
                      />
                    ))}
                  </p>
                  <span className="flex flex-shrink-0 items-center gap-1.5">
                    {/* El responsable del chat (00255): quien la mira sabe de quien es sin abrirla. */}
                    {conversation.assigned_to && (
                      <PersonAvatar
                        userId={conversation.assigned_to}
                        name={assigneeName(members, conversation.assigned_to)}
                        role="Responsable"
                        size="sm"
                        emptyLabel="Responsable: alguien que ya no está en el equipo"
                      />
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {mounted ? formatTime(conversation.last_message_at, timeZone) : ""}
                    </span>
                  </span>
                </div>
                {/* Con varias cuentas de la misma red, la cuenta por la que entro. */}
                {accountToShow(accounts, conversation) && (
                  <Tip asChild content={`Cuenta: ${accountToShow(accounts, conversation)}`}>
                    <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
                      {accountToShow(accounts, conversation)}
                    </p>
                  </Tip>
                )}
                <div className="flex items-center justify-between">
                  {/* 00262: el ultimo mensaje de la conversacion, sea del
                      contacto o nuestro ("Vos: ..."). */}
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {conversationListPreview(conversation)}
                  </p>
                  {/* F11: el agente no pudo entender lo que llego y no
                      respondio. Hay un lead esperando a una persona, asi que va
                      en rojo y con el motivo al pasar el mouse. */}
                  {needsHumanBadge(conversation).show && (
                    <Tip asChild content={needsHumanBadge(conversation).title}>
                      <span className="ml-2 inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
                        <UserRoundSearch className="h-3 w-3" aria-hidden />
                        {needsHumanBadge(conversation).label}
                      </span>
                    </Tip>
                  )}
                  {/* Bloque 2d: el agente dejo una respuesta para aprobar. Un
                      borrador es una conversacion esperando respuesta: se
                      entra directo al hilo, donde esta arriba del composer. */}
                  {withDraft.has(conversation.id) && (
                    // Solo el icono: el texto ocupaba media fila. El tooltip
                    // (y el aria-label) dicen que es.
                    <Tip content="Borrador esperando" className="ml-2 flex-shrink-0">
                      <span
                        role="img"
                        aria-label="Borrador esperando"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-amber-400 text-amber-700 dark:text-amber-300"
                      >
                        <FileText className="h-3 w-3" aria-hidden />
                      </span>
                    </Tip>
                  )}
                  {/* 00259: el ultimo mensaje solo cierra la charla. Gris: no
                      es una alerta, explica por que no cuenta como esperando. */}
                  {noReplyBadge(conversation).show && (
                    <Tip asChild content={noReplyBadge(conversation).detail}>
                      <span className="ml-2 inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <CheckCheck className="h-3 w-3" aria-hidden />
                        <span className="hidden sm:inline">No necesita respuesta</span>
                        <span className="sr-only sm:hidden">No necesita respuesta</span>
                      </span>
                    </Tip>
                  )}
                  {conversation.unread_count > 0 && (
                    <span className="ml-2 flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {conversation.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
            </div>
            );
          })
        )}
        {/* Scroll infinito: al acercarse este final se pide la tanda siguiente. */}
        {(hasMore || loadError) && (
          <div ref={sentinelRef} className="flex justify-center px-4 py-4">
            {loadError ? (
              <div role="alert" className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
                <span>{loadError}</span>
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground hover:bg-accent"
                >
                  Reintentar
                </button>
              </div>
            ) : (
              <span className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {loadingMore ? "Cargando más chats…" : ""}
              </span>
            )}
          </div>
        )}
        {!hasMore && !loadError && conversations.length > 0 && (
          <p className="px-4 py-4 text-center text-xs text-muted-foreground">No hay más chats</p>
        )}
      </div>
    </div>
  );
}

/** Un grupo de WhatsApp en la lista (00280): se abre igual que un chat y no tiene "⋯" (no hay un contacto que marcar). */
function GroupRow({
  group,
  selected,
  account,
  time,
  onSelect,
}: {
  group: GroupListRow;
  selected: boolean;
  /** La cuenta, solo si hay mas de un WhatsApp. */
  account: string | null;
  time: string;
  onSelect: () => void;
}) {
  const display = groupDisplayName(group);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border py-3 pl-3 pr-9 text-left transition-colors hover:bg-accent/50",
        selected && "bg-accent",
      )}
    >
      <div className="relative flex-shrink-0">
        <span
          role="img"
          aria-label="Grupo"
          className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
        >
          <Users className="h-4 w-4" aria-hidden />
        </span>
        <div className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 border-background bg-background">
          <PlatformIcon platform="whatsapp" className="h-3 w-3" size={12} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <Tip asChild content={display.community ? `${display.community} › ${display.name}` : display.name}>
            <p className="min-w-0 truncate text-sm font-medium">{display.name}</p>
          </Tip>
          <span className="flex-shrink-0 text-[11px] text-muted-foreground">{time}</span>
        </div>
        {display.community && (
          <p className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[11px] font-medium text-muted-foreground">
            {group.kind === "announce" ? <Megaphone className="h-3 w-3 shrink-0" aria-hidden /> : <UsersRound className="h-3 w-3 shrink-0" aria-hidden />}
            <span className="truncate">Comunidad {display.community}</span>
          </p>
        )}
        {account && (
          <Tip asChild content={`Cuenta: ${account}`}>
            <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">{account}</p>
          </Tip>
        )}
        <div className="flex items-center justify-between">
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{group.preview?.trim() || EMPTY_PREVIEW}</p>
          {group.unread > 0 && (
            <span className="ml-2 flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
              {group.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/** Se pidio ver solo grupos y todavia no hay ninguno: aparecen solos; abrir la lista de Grupos los trae ya. */
function NoGroupsYet({ canManageGroups }: { canManageGroups: boolean }) {
  return (
    <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
      <UsersRound className="mx-auto h-8 w-8" aria-hidden />
      <p>Todavía no hay grupos para ver acá.</p>
      <p className="text-xs">
        Aparecen solos cuando llega un mensaje. Para traerlos ya, abrí{" "}
        {canManageGroups ? (
          <Link href="/dashboard/settings/integrations/evolution" className="text-primary-ink underline">
            Ajustes → Integraciones → WhatsApp → Grupos
          </Link>
        ) : (
          "Ajustes → Integraciones → WhatsApp → Grupos (lo hace un administrador)"
        )}
        .
      </p>
    </div>
  );
}
