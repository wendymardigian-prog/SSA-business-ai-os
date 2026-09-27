"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ConfigShell } from "./config-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { Notice } from "@/components/agents/fields";
import { CONNECTION_STATUS_TEXT, type CalendarConnectionStatus } from "@/lib/scheduling/bookable";
import { isWritable } from "@/lib/scheduling/calendars";
import type { CalendarAccessRole } from "@/lib/types/database";
import {
  countEventsUsingConnection,
  disconnectGoogleCalendar,
  resyncCalendars,
  setCalendarCheckConflicts,
  setDefaultDestinationCalendar,
} from "@/lib/actions/scheduling/calendars";

export interface AccountView {
  id: string;
  label: string;
  status: CalendarConnectionStatus;
  lastError: string | null;
  calendars: Array<{ id: string; name: string; color: string | null; accessRole: CalendarAccessRole; isPrimary: boolean; checkConflicts: boolean; isActive: boolean }>;
}

const STATUS_CLASS: Record<CalendarConnectionStatus, string> = {
  connected: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  attention: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  revoked: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

const ROLE_TEXT: Record<CalendarAccessRole, string> = {
  owner: "Tuyo",
  writer: "Podés escribir",
  reader: "Solo lectura",
  freeBusyReader: "Solo ocupado",
};

/**
 * Calendarios de Google (F5): una tarjeta por cuenta, sus calendarios con el
 * switch "Revisar conflictos", y arriba el calendario destino por defecto.
 */
export function CalendarsView({
  canUse,
  hasProfile,
  defaultDestinationId,
  accounts,
  flash,
}: {
  canUse: boolean;
  hasProfile: boolean;
  defaultDestinationId: string | null;
  accounts: AccountView[];
  flash: { tone: "success" | "error"; text: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<{ account: AccountView; events: number } | null>(null);

  const connectHref = "/api/oauth/google_calendar/start?redirect_to=/dashboard/agenda/configuracion/calendarios";
  const writable = accounts.flatMap((a) => a.calendars.filter((c) => c.isActive && isWritable(c.accessRole)).map((c) => ({ ...c, account: a.label })));

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "No se pudo");
      router.refresh();
    });
  }

  return (
    <ConfigShell
      route="/dashboard/agenda/configuracion/calendarios"
      right={
        canUse ? (
          <a
            href={hasProfile ? connectHref : undefined}
            aria-disabled={!hasProfile}
            title={hasProfile ? undefined : "Primero completá tu perfil en Ajustes"}
            className={`inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground ${hasProfile ? "" : "pointer-events-none opacity-50"}`}
          >
            + Conectar cuenta de Google
          </a>
        ) : undefined
      }
    >
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!hasProfile && canUse && (
        <Notice tone="info">
          Antes de conectar una cuenta de Google, elegí tu usuario y tu zona horaria en Ajustes.
        </Notice>
      )}

      {accounts.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Dónde se crean los eventos</h2>
          <p className="mt-1 text-xs text-muted-foreground">Cada evento puede usar otro calendario destino.</p>
          <div className="mt-3 grid gap-2 md:grid-cols-[200px_1fr] md:items-center">
            <label htmlFor="destino" className="text-sm text-muted-foreground">
              Calendario destino por defecto
            </label>
            <select
              id="destino"
              value={defaultDestinationId ?? ""}
              disabled={pending}
              onChange={(e) => run(() => setDefaultDestinationCalendar(e.target.value || null))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Elegí un calendario destino</option>
              {writable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.account}
                </option>
              ))}
            </select>
          </div>
          {!defaultDestinationId && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Elegí un calendario destino: sin él, los eventos con Meet no se pueden activar.</p>
          )}
        </section>
      )}

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <h2 className="text-base font-semibold">Conectá tu Google Calendar</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Con tu cuenta conectada, el sistema lee tus horarios ocupados y crea las agendas con Meet en tu calendario. Podés conectar más de una cuenta.
          </p>
          {canUse && hasProfile && (
            <a href={connectHref} className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Conectar Google Calendar
            </a>
          )}
        </div>
      ) : (
        accounts.map((account) => (
          <section key={account.id} className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{account.label}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[account.status]}`}>{CONNECTION_STATUS_TEXT[account.status]}</span>
              <span className="ml-auto flex gap-2">
                <a href={`${connectHref}&login_hint=${encodeURIComponent(account.label)}`} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted">
                  Reconectar
                </a>
                <button type="button" disabled={pending} onClick={() => run(() => resyncCalendars(account.id))} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">
                  Actualizar calendarios
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await countEventsUsingConnection(account.id);
                      setDisconnecting({ account, events: r.ok ? r.data.events : 0 });
                    })
                  }
                  className="rounded-lg border border-border px-2.5 py-1 text-xs text-red-600 hover:bg-muted disabled:opacity-50"
                >
                  Desconectar
                </button>
              </span>
            </div>
            {account.status === "attention" && account.lastError && <p className="mt-1 text-xs text-muted-foreground">{account.lastError}</p>}
            {account.status === "attention" && !account.lastError && (
              <p className="mt-1 text-xs text-muted-foreground">Sin el permiso de crear eventos, esta cuenta sirve solo para revisar conflictos. Reconectala y aceptá todos los permisos.</p>
            )}
            <ul className="mt-4 divide-y divide-border">
              {account.calendars.filter((c) => c.isActive).map((cal) => (
                <li key={cal.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Switch
                    checked={cal.checkConflicts}
                    disabled={pending}
                    label={`Revisar conflictos en ${cal.name}`}
                    onChange={(v) => run(() => setCalendarCheckConflicts(cal.id, v))}
                  />
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: cal.color ?? "#94a3b8" }} aria-hidden="true" />
                  <span className="text-sm">
                    {cal.name}
                    {cal.isPrimary && <span className="ml-1 text-xs text-muted-foreground">· principal</span>}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {ROLE_TEXT[cal.accessRole]} · {cal.checkConflicts ? "Se revisa para no superponer agendas" : "No se revisa"}
                  </span>
                </li>
              ))}
              {account.calendars.filter((c) => c.isActive).length === 0 && (
                <li className="py-2 text-sm text-muted-foreground">Esta cuenta no tiene calendarios. Tocá &quot;Actualizar calendarios&quot;.</li>
              )}
            </ul>
          </section>
        ))
      )}

      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Guardando" />}

      <ConfirmDialog
        open={disconnecting !== null}
        title={`Desconectar ${disconnecting?.account.label ?? ""}`}
        message={
          disconnecting
            ? `${disconnecting.events === 0 ? "Ningún evento usa calendarios de esta cuenta." : `${disconnecting.events} evento(s) usan calendarios de esta cuenta y van a volver a usar los de tu perfil.`} Se borran los tokens y sus calendarios dejan de revisarse.`
            : ""
        }
        confirmLabel="Desconectar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          const id = disconnecting?.account.id;
          setDisconnecting(null);
          if (id) run(() => disconnectGoogleCalendar(id));
        }}
        onCancel={() => setDisconnecting(null)}
      />
    </ConfigShell>
  );
}
