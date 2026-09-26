"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { EmptyState, FilterBar, FilterSelect, Pagination, useUrlFilters } from "@/components/agents/filters";
import { DRAFTS_PAGE_SIZE, QUIEN_ALL, QUIEN_MINE, QUIEN_UNASSIGNED, type DraftFilters, type DraftQueue } from "@/lib/agent/drafts/queue-query";
import { DraftQueueItem } from "./draft-card";
import { WindowLegend } from "./window-badge";

/**
 * La cola de borradores (Bloque 2c). El trabajo aca es procesar una cola, no
 * navegar conversaciones: por eso es una pantalla propia y no una pestana de
 * la bandeja.
 *
 * Por defecto muestra "los mios": dos personas no abren el mismo borrador si
 * cada una ve el suyo. El bloqueo optimista de las acciones cubre el resto.
 * Realtime sobre agent_drafts: una fila aparece cuando el agente deja un
 * borrador y desaparece cuando un colega lo toma.
 */
export function DraftsView({
  workspaceId,
  queue,
  filters,
  members,
  channels,
  isAdmin,
  draftChannels,
  agentId,
  metrics,
}: {
  workspaceId: string;
  queue: DraftQueue;
  filters: DraftFilters;
  members: Array<{ userId: string; label: string }>;
  channels: Array<{ id: string; label: string }>;
  isAdmin: boolean;
  /** Cuantos canales tiene el agente en modo borrador (para el empty state). */
  draftChannels: number;
  agentId: string | null;
  /** La franja de medicion (se arma en el servidor). */
  metrics?: ReactNode;
}) {
  const router = useRouter();
  const { pending, setParam, setPage, clearAll } = useUrlFilters();
  const labels = new Map(members.map((m) => [m.userId, m.label]));

  // Realtime: cualquier cambio en los borradores del workspace refresca la
  // consulta (la RLS filtra que eventos llegan). Con un pequeno retardo, para
  // que una rafaga de cambios sea un solo refresco.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      // Sin sesion el canal se suscribiria como anonimo y no llegaria nada.
      await supabase.auth.getSession();
      if (cancelled) return;
      channel = supabase
        .channel(`agent-drafts-${workspaceId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "agent_drafts", filter: `workspace_id=eq.${workspaceId}` }, () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => router.refresh(), 800);
        })
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [workspaceId, router]);

  const activeCount =
    (filters.quien !== QUIEN_MINE ? 1 : 0) +
    (filters.estado !== "pendientes" ? 1 : 0) +
    (filters.ventana ? 1 : 0) +
    (filters.canal ? 1 : 0) +
    (filters.contacto ? 1 : 0);

  const whoOptions = [
    { value: QUIEN_UNASSIGNED, label: "Sin asignar" },
    ...(isAdmin || members.length > 1 ? [{ value: QUIEN_ALL, label: "Todos" }] : []),
    ...members.map((m) => ({ value: m.userId, label: m.label })),
  ];

  const noDraftsAnywhere = !queue.anyDraft && draftChannels === 0;

  return (
    <div className="space-y-4">
      {metrics}

      <FilterBar activeCount={activeCount} onClear={() => clearAll([])} pending={pending}>
        <FilterSelect
          label="De quién"
          allLabel="míos"
          value={filters.quien === QUIEN_MINE ? "" : filters.quien}
          onChange={(v) => setParam("quien", v)}
          options={whoOptions}
        />
        <FilterSelect
          label="Estado"
          allLabel="pendientes"
          value={filters.estado === "pendientes" ? "" : filters.estado}
          onChange={(v) => setParam("estado", v)}
          options={[{ value: "todos", label: "Todos (historial)" }]}
        />
        {filters.estado === "pendientes" && (
          <>
            <FilterSelect
              label="Ventana"
              allLabel="todas"
              value={filters.ventana}
              onChange={(v) => setParam("ventana", v)}
              options={[
                { value: "por-vencer", label: `Por vencer (${queue.aboutToExpire})` },
                { value: "cerradas", label: "Solo no enviables" },
              ]}
            />
            {queue.aboutToExpire > 0 && filters.ventana !== "por-vencer" && (
              <button
                type="button"
                onClick={() => setParam("ventana", "por-vencer")}
                className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-800 hover:bg-orange-200 dark:bg-orange-950/50 dark:text-orange-200"
              >
                {queue.aboutToExpire} por vencer
              </button>
            )}
          </>
        )}
        {channels.length > 1 && (
          <FilterSelect label="Canal" value={filters.canal} onChange={(v) => setParam("canal", v)} options={channels.map((c) => ({ value: c.id, label: c.label }))} />
        )}
        {filters.contacto && (
          <button type="button" onClick={() => setParam("contacto", "")} className="rounded-full border border-primary px-2.5 py-1 text-xs">
            Un contacto ✕
          </button>
        )}
      </FilterBar>

      {filters.estado === "pendientes" && <WindowLegend />}

      {queue.rows.length === 0 ? (
        noDraftsAnywhere ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/40" aria-hidden />
            <p className="mt-3 text-sm font-medium">Ningún canal deja borradores todavía</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              Cuando un canal está en modo borrador, el agente redacta las respuestas y las deja acá para que alguien las apruebe antes de que salgan.
            </p>
            {isAdmin && agentId && (
              <Link
                href={`/dashboard/agents/${agentId}?tab=channels`}
                className="mt-3 rounded-lg border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                Configurar los canales del agente
              </Link>
            )}
          </div>
        ) : activeCount > 0 ? (
          <EmptyState
            icon={<Inbox className="h-10 w-10" />}
            title="No hay borradores esperando"
            text=""
            filtered
            onClear={() => clearAll([])}
          />
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground/40" aria-hidden />
            <p className="mt-3 text-sm font-medium">No hay borradores esperando</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              Cuando el agente deje una respuesta para aprobar en una conversación tuya, aparece acá sola.
            </p>
            <button
              type="button"
              onClick={() => setParam("quien", QUIEN_ALL)}
              className="mt-3 rounded-lg border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              Ver los de todos
            </button>
          </div>
        )
      ) : (
        // Sin overflow-hidden en el telefono: cortaria la barra de botones
        // pegada al pie de cada tarjeta (sticky no funciona adentro de un
        // contenedor que recorta).
        <div className="rounded-xl border border-border queue:overflow-hidden">
          <div className="hidden grid-cols-[minmax(150px,0.9fr)_minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(200px,1fr)] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase text-muted-foreground queue:grid">
            <span>Contacto</span>
            <span>Lo que escribió</span>
            <span>Respuesta propuesta</span>
            <span>Lo que hizo el agente</span>
            <span>Decisión</span>
          </div>
          <ul className="divide-y divide-border">
            {queue.rows.map((row) => (
              <DraftQueueItem
                key={row.id}
                draft={row}
                ownerLabel={row.ownerId ? (labels.get(row.ownerId) ?? "otra persona") : null}
                onDone={() => router.refresh()}
              />
            ))}
          </ul>
        </div>
      )}

      <Pagination page={filters.page} total={queue.total} pageSize={DRAFTS_PAGE_SIZE} onPage={setPage} />
    </div>
  );
}
