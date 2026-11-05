"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Users, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { markGroupRead } from "@/lib/actions/whatsapp-group-inbox";
import type { GroupListRow, ThreadMessage } from "@/lib/whatsapp-groups/thread";
import { InboxViewSwitch } from "@/components/inbox/inbox-view-switch";
import { cn } from "@/lib/utils";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { GroupMessageBubble } from "./group-message-bubble";
import { GroupComposer } from "./group-composer";

export interface SelectedGroup {
  id: string;
  subject: string;
  channelLabel: string;
  canWrite: boolean;
  members: Array<{ key: string; label: string; contactId: string | null }>;
}

/**
 * La vista «Grupos» de la bandeja (00280): la lista de los grupos activados y, al elegir uno, su hilo con quién
 * escribió, reacciones y encuestas. Lo que llega se ve solo (tiempo real: vuelve a pedir la página).
 */
export function GroupsView({
  groups,
  selected,
  thread,
  canCreateAutomation,
  canManageGroups,
}: {
  groups: GroupListRow[];
  selected: SelectedGroup | null;
  thread: ThreadMessage[];
  canCreateAutomation: boolean;
  canManageGroups: boolean;
}) {
  const router = useRouter();
  const timeZone = useViewerTimezone();
  const [membersOpen, setMembersOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedId = selected?.id ?? null;

  // Tiempo real: un mensaje, una reaccion o un voto nuevo vuelven a pedir la pagina (sin parpadeo, con un respiro).
  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 400);
    };
    let channel = supabase.channel(`whatsapp-groups-${selectedId ?? "list"}`).on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_groups" }, refresh);
    if (selectedId) {
      for (const table of ["whatsapp_group_messages", "whatsapp_group_reactions", "whatsapp_poll_votes"]) {
        channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `group_id=eq.${selectedId}` }, refresh);
      }
    }
    channel.subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [router, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    void markGroupRead(selectedId);
  }, [selectedId, thread.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [selectedId, thread.length]);

  return (
    <div className="flex h-full min-h-0">
      <div className={cn("w-full flex-shrink-0 border-r border-border md:block md:w-80", selected ? "hidden" : "block")}>
        <div className="flex h-12 items-center gap-1.5 border-b border-border px-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Grupos</h2>
          <InboxViewSwitch current="grupos" />
        </div>
        {groups.length === 0 ? (
          <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
            <UsersRound className="mx-auto h-8 w-8" aria-hidden />
            <p>Todavía no hay grupos para ver acá.</p>
            <p className="text-xs">
              Se activan por número en{" "}
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
        ) : (
          <ul className="min-h-0 overflow-y-auto">
            {groups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/dashboard/inbox?vista=grupos&g=${g.id}`}
                  aria-current={g.id === selectedId ? "true" : undefined}
                  className={cn("flex items-start gap-2 border-b border-border px-3 py-2.5 hover:bg-muted", g.id === selectedId && "bg-muted")}
                >
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    <Users className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn("min-w-0 flex-1 truncate text-sm", g.unread > 0 ? "font-semibold" : "font-medium")}>{g.subject}</span>
                      {g.lastMessageAt && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {new Date(g.lastMessageAt).toLocaleDateString("es", { day: "numeric", month: "short", timeZone })}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{g.preview || g.channelLabel}</span>
                      {g.unread > 0 && (
                        <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground">{g.unread}</span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", selected ? "flex" : "hidden")}>
        {selected ? (
          <>
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
              <Link href="/dashboard/inbox?vista=grupos" aria-label="Volver a los grupos" className="rounded p-1 hover:bg-muted md:hidden">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{selected.subject}</p>
                <p className="truncate text-[11px] text-muted-foreground">{selected.channelLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => setMembersOpen((v) => !v)}
                aria-expanded={membersOpen}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
              >
                <Users className="h-3.5 w-3.5" aria-hidden />
                {selected.members.length} miembros
              </button>
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                  {thread.length === 0 ? (
                    <p className="pt-10 text-center text-sm text-muted-foreground">Todavía no hay mensajes. Lo que se escriba en el grupo desde ahora va a aparecer acá.</p>
                  ) : (
                    thread.map((m) => <GroupMessageBubble key={m.id} message={m} canCreateAutomation={canCreateAutomation} />)
                  )}
                  <div ref={bottomRef} />
                </div>
                {selected.canWrite ? (
                  <GroupComposer groupId={selected.id} onSent={() => router.refresh()} />
                ) : (
                  <p className="border-t border-border p-3 text-center text-xs text-muted-foreground">Tu rol puede leer este grupo pero no escribir.</p>
                )}
              </div>
              {membersOpen && (
                <aside className="fixed inset-0 z-40 flex flex-col bg-background md:static md:z-auto md:w-72 md:border-l md:border-border" aria-label="Miembros del grupo">
                  <div className="flex h-12 items-center justify-between border-b border-border px-3">
                    <p className="text-sm font-semibold">Miembros</p>
                    <button type="button" onClick={() => setMembersOpen(false)} className="rounded px-2 py-1 text-xs hover:bg-muted">
                      Cerrar
                    </button>
                  </div>
                  <ul className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
                    {selected.members.length === 0 ? (
                      <li className="p-2 text-xs text-muted-foreground">
                        Todavía no hay miembros guardados. Aparecen cuando alguien entra o escribe, o con «Importar miembros» en Ajustes → WhatsApp → Grupos.
                      </li>
                    ) : (
                      selected.members.map((m) => (
                        <li key={m.key} className="truncate rounded px-2 py-1 hover:bg-muted">
                          {m.contactId ? (
                            <Link href={`/dashboard/contacts/${m.contactId}`} className="text-primary-ink hover:underline">
                              {m.label}
                            </Link>
                          ) : (
                            m.label
                          )}
                        </li>
                      ))
                    )}
                  </ul>
                </aside>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Elegí un grupo para ver sus mensajes.</div>
        )}
      </div>
    </div>
  );
}
