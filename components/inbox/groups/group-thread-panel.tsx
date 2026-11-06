"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { markGroupRead } from "@/lib/actions/whatsapp-group-inbox";
import type { SelectedGroup, ThreadMessage } from "@/lib/whatsapp-groups/thread";
import { GroupMessageBubble } from "./group-message-bubble";
import { GroupComposer } from "./group-composer";

/**
 * El hilo de un grupo de WhatsApp en la bandeja (00280): quién escribió, reacciones y encuestas. Lo que llega se ve
 * solo (tiempo real: vuelve a pedir la página).
 */
export function GroupThreadPanel({
  group,
  thread,
  canCreateAutomation,
  onBack,
}: {
  group: SelectedGroup;
  thread: ThreadMessage[];
  canCreateAutomation: boolean;
  /** Teléfono: volver del hilo a la lista. */
  onBack: () => void;
}) {
  const router = useRouter();
  const [membersOpen, setMembersOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupId = group.id;

  // Tiempo real: un mensaje, una reaccion o un voto nuevo vuelven a pedir la pagina (sin parpadeo, con un respiro).
  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 400);
    };
    let channel = supabase.channel(`whatsapp-group-${groupId}`);
    for (const table of ["whatsapp_group_messages", "whatsapp_group_reactions", "whatsapp_poll_votes"]) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `group_id=eq.${groupId}` }, refresh);
    }
    channel.subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [router, groupId]);

  useEffect(() => {
    void markGroupRead(groupId);
  }, [groupId, thread.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [groupId, thread.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <button type="button" onClick={onBack} aria-label="Volver a la lista" className="rounded p-1 hover:bg-muted md:hidden">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{group.subject}</p>
          <p className="truncate text-[11px] text-muted-foreground">{group.channelLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => setMembersOpen((v) => !v)}
          aria-expanded={membersOpen}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          <Users className="h-3.5 w-3.5" aria-hidden />
          {group.members.length} miembros
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
          {group.canWrite ? (
            <GroupComposer groupId={group.id} onSent={() => router.refresh()} />
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
              {group.members.length === 0 ? (
                <li className="p-2 text-xs text-muted-foreground">
                  Todavía no hay miembros guardados. Aparecen cuando alguien entra o escribe, o con «Importar miembros» en Ajustes → WhatsApp → Grupos.
                </li>
              ) : (
                group.members.map((m) => (
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
    </div>
  );
}
