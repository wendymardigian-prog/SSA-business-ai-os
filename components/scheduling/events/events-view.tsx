"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfigShell } from "../config-shell";
import { NewEventDialog } from "./new-event-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Notice } from "@/components/agents/fields";
import { Switch } from "@/components/ui/switch";
import { categoryTree, categoryLabel, resolveCategory, type CategoryRow } from "@/lib/scheduling/categories";
import { EVENT_STATUS_LABELS } from "@/lib/scheduling/event-validation";
import type { EventTypeStatus } from "@/lib/types/database";
import { deleteEventType, duplicateEventType, setEventStatus } from "@/lib/actions/scheduling/event-types";

export interface EventCard {
  id: string;
  title: string;
  slug: string;
  categoryId: string;
  durationMinutes: number;
  color: string | null;
  locationType: "google_meet" | "manual";
  status: EventTypeStatus;
  ownerUserId: string;
  ownerLabel: string;
  ownerUsername: string | null;
}

/**
 * Configuracion de agenda > Eventos (F17): tarjetas agrupadas por area, con
 * el link, la vista previa, el switch Activo/Inactivo y el menu.
 */
export function EventsView({
  events,
  categories,
  publicBase,
  canCreate,
  hasProfile,
  hasCalendar,
  username,
  defaults,
  members,
  targetUserId,
  canManageOthers,
}: {
  events: EventCard[];
  categories: CategoryRow[];
  publicBase: string;
  canCreate: boolean;
  hasProfile: boolean;
  hasCalendar: boolean;
  username: string;
  defaults: { scheduleName: string | null; destinationCalendar: string | null; conflictCount: number; autoFlows: boolean };
  members: Array<{ userId: string; label: string; hasGoogle?: boolean }>;
  targetUserId: string | null;
  canManageOthers: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; message: string } | null>(null);

  const tree = categoryTree(categories);
  const visible = areaFilter ? events.filter((e) => resolveCategory(e.categoryId, categories).area?.id === areaFilter) : events;

  function run(action: () => Promise<{ ok: boolean; error?: string; needsConfirmation?: boolean }>, onNeedsConfirm?: (message: string) => void, done?: () => void) {
    setError(null);
    start(async () => {
      const r = await action();
      if (!r.ok) {
        if (r.needsConfirmation && onNeedsConfirm) onNeedsConfirm(r.error ?? "");
        else setError(r.error ?? "No se pudo");
        return;
      }
      done?.();
      router.refresh();
    });
  }

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  const linkOf = (e: EventCard) => `${publicBase}${e.ownerUsername ?? username}/${e.slug}`;

  return (
    <ConfigShell
      route="/dashboard/agenda/configuracion/eventos"
      right={
        canCreate ? (
          <button type="button" disabled={!hasProfile} title={hasProfile ? undefined : "Primero completá tu perfil en Ajustes"} onClick={() => setShowNew(true)} className="inline-flex h-9 items-center whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <span className="sm:hidden">+ Evento</span>
            <span className="hidden sm:inline">+ Nuevo evento</span>
          </button>
        ) : undefined
      }
      filters={
        <div className="flex items-center gap-2">
          {tree.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Área</span>
              <select aria-label="Área" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground">
                <option value="">Todas</option>
                {tree.map(({ area }) => (
                  <option key={area.id} value={area.id}>{area.name}</option>
                ))}
              </select>
            </label>
          )}
          {canManageOthers && members.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Persona</span>
              <select aria-label="Persona" value={targetUserId ?? ""} onChange={(e) => router.push(`/dashboard/agenda/configuracion/eventos${e.target.value ? `?persona=${e.target.value}` : ""}`)} className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground">
                <option value="">Todo el equipo</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.label}
                    {m.hasGoogle === false ? " (sin Google Calendar)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      }
    >
      {toast && <Notice tone="success">{toast}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <h2 className="text-base font-semibold">Creá tu primer evento</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Un evento es un tipo de llamada que se puede agendar: su duración, su formulario y su link propio.
          </p>
          {!hasCalendar && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
              Conectá tu Google Calendar primero:{" "}
              <Link href="/dashboard/agenda/configuracion/calendarios" className="underline">ir a Calendarios</Link>
            </p>
          )}
          {canCreate && hasProfile && (
            <button type="button" onClick={() => setShowNew(true)} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">+ Nuevo evento</button>
          )}
        </div>
      ) : (
        tree
          .filter(({ area }) => !areaFilter || area.id === areaFilter)
          .map(({ area, types }) => {
            const inArea = visible.filter((e) => resolveCategory(e.categoryId, categories).area?.id === area.id);
            if (inArea.length === 0) return null;
            return (
              <section key={area.id}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: area.color ?? "#94a3b8" }} aria-hidden="true" />
                  <h2 className="text-sm font-semibold">{area.name}</h2>
                  <span className="text-xs text-muted-foreground">
                    {inArea.length} {inArea.length === 1 ? "evento" : "eventos"}
                    {types.length > 0 ? ` · ${types.map((t) => t.name).join(", ")}` : ""}
                  </span>
                </div>
                <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {inArea.map((e) => (
                    <article key={e.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start gap-2">
                        <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: e.color ?? "#94a3b8" }} aria-hidden="true" />
                        <h3 className="min-w-0 flex-1 text-sm font-semibold">{e.title}</h3>
                        <Switch
                          checked={e.status !== "inactive"}
                          disabled={pending}
                          label={`${e.title}: ${e.status === "inactive" ? "activar" : "desactivar"}`}
                          onChange={(on) => run(() => setEventStatus({ eventId: e.id, status: on ? "active" : "inactive" }), undefined, () => flash(on ? "Evento activado" : "Evento desactivado"))}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {e.durationMinutes} min · {e.locationType === "google_meet" ? "Google Meet" : "Ubicación manual"} · {categoryLabel(e.categoryId, categories)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {e.ownerLabel} · <span className={e.status === "active" ? "text-emerald-600" : ""}>{EVENT_STATUS_LABELS[e.status]}</span>
                      </p>
                      <p className="mt-2 truncate rounded-lg bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground" title={linkOf(e)}>{linkOf(e)}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                        <button type="button" onClick={() => { navigator.clipboard?.writeText(linkOf(e)); flash("Link copiado"); }} className="rounded-lg border border-border px-2 py-1 hover:bg-muted">Copiar link</button>
                        <a href={`/calendario/${e.ownerUsername ?? username}/${e.slug}`} target="_blank" rel="noreferrer" className="rounded-lg border border-border px-2 py-1 hover:bg-muted">Vista previa</a>
                        <Link href={`/dashboard/agenda/configuracion/eventos/${e.id}`} className="rounded-lg border border-border px-2 py-1 hover:bg-muted">Editar</Link>
                        <button type="button" disabled={pending} onClick={() => run(() => duplicateEventType(e.id), undefined, () => flash("Evento duplicado"))} className="rounded-lg border border-border px-2 py-1 hover:bg-muted">Duplicar</button>
                        <button type="button" disabled={pending} onClick={() => run(() => deleteEventType({ eventId: e.id }), (message) => setConfirmDelete({ id: e.id, message }), () => flash("Evento borrado"))} className="rounded-lg border border-border px-2 py-1 text-red-600 hover:bg-muted">Borrar</button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })
      )}

      {showNew && (
        <NewEventDialog
          categories={categories}
          publicBase={publicBase}
          username={username}
          defaults={defaults}
          forUserId={targetUserId}
          forUserLabel={targetUserId ? members.find((m) => m.userId === targetUserId)?.label ?? null : null}
          canManageOthers={canManageOthers}
          onClose={() => setShowNew(false)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Borrar el evento"
        message={confirmDelete?.message ?? ""}
        confirmLabel="Borrar igual"
        cancelLabel="Dejarlo"
        destructive
        onConfirm={() => {
          const id = confirmDelete?.id;
          setConfirmDelete(null);
          if (id) run(() => deleteEventType({ eventId: id, confirm: true }), undefined, () => flash("Evento borrado"));
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </ConfigShell>
  );
}
