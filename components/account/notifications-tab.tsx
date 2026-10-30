"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Mail, MessageCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { resetNotificationPrefs, setNotificationPref } from "@/lib/actions/account";
import { createSaveQueue } from "@/lib/roles/save-queue";
import {
  CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  eventByKey,
  resolveEventPrefs,
  type NotificationChannel,
  type StoredPrefs,
} from "@/lib/notifications/preferences";
import { accountTabHref } from "@/lib/account/tabs";
import { AccountCard, secondaryButtonClass } from "./account-card";
import { cn } from "@/lib/utils";

export interface NotificationsTabSection {
  key: string;
  title: string;
  events: Array<{ key: string; label: string; description: string }>;
}

export interface NotificationsTabProps {
  sections: NotificationsTabSection[];
  initialPrefs: StoredPrefs;
  email: { address: string; configured: boolean };
  whatsapp: {
    /** El numero de la persona (Perfil), o null. */
    number: string | null;
    /** Si el negocio eligio desde que WhatsApp avisar. */
    channelReady: boolean;
    /** Owner/Admin: puede ir a elegirlo. */
    canConfigure: boolean;
  };
}

const ICONS: Record<NotificationChannel, typeof Bell> = { bell: Bell, email: Mail, whatsapp: MessageCircle };

function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Mi cuenta → Notificaciones: una tabla por seccion, tres interruptores por fila, guardado al instante. */
export function NotificationsTab({ sections, initialPrefs, email, whatsapp }: NotificationsTabProps) {
  const [prefs, setPrefs] = useState<StoredPrefs>(initialPrefs);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  const queueRef = useRef<ReturnType<typeof createSaveQueue> | null>(null);
  if (!queueRef.current) queueRef.current = createSaveQueue(setPending);

  const whatsappReady = whatsapp.channelReady && Boolean(whatsapp.number);
  const available: Record<NotificationChannel, boolean> = { bell: true, email: email.configured, whatsapp: whatsappReady };

  function toggle(eventKey: string, channel: NotificationChannel, value: boolean) {
    const event = eventByKey(eventKey);
    if (!event) return;
    const previous = prefs;
    // Optimista: se ve el cambio enseguida; si falla, vuelve SOLO ese interruptor.
    setPrefs((current) => {
      const own = { ...(current[eventKey] ?? {}) };
      if (value === event.defaults[channel]) delete own[channel];
      else own[channel] = value;
      const next = { ...current };
      if (Object.keys(own).length) next[eventKey] = own;
      else delete next[eventKey];
      return next;
    });
    setError(null);
    queueRef.current!.enqueue(async () => {
      const result = await setNotificationPref({ eventKey, channel, value, browserTimezone: browserTimezone() });
      if (!result.ok) {
        setError(result.error);
        setPrefs((current) => {
          const next = { ...current };
          const was = previous[eventKey];
          if (was) next[eventKey] = { ...(next[eventKey] ?? {}), [channel]: was[channel] };
          else if (next[eventKey]) {
            const own = { ...next[eventKey] };
            delete own[channel];
            if (Object.keys(own).length) next[eventKey] = own;
            else delete next[eventKey];
          }
          return next;
        });
        return;
      }
      setSavedOnce(true);
    });
  }

  async function reset() {
    setError(null);
    const before = prefs;
    setPrefs({});
    await queueRef.current!.enqueue(async () => {
      const result = await resetNotificationPrefs({ browserTimezone: browserTimezone() });
      if (!result.ok) {
        setError(result.error);
        setPrefs(before);
      } else setSavedOnce(true);
    });
  }

  const hasChanges = Object.keys(prefs).length > 0;

  return (
    <div className="space-y-4">
      <AccountCard title="Por dónde te llegan" description="Elegí, aviso por aviso, si te llega a la campana, por email o por WhatsApp.">
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <span className="font-medium">Campana:</span> el aviso aparece en la campana del panel, en el momento.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <span className="font-medium">Email:</span>{" "}
              {email.configured ? (
                <>
                  te llegan a <span className="break-all">{email.address}</span>.
                </>
              ) : (
                <span className="text-muted-foreground">este negocio todavía no tiene el envío de emails conectado.</span>
              )}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <span className="font-medium">WhatsApp:</span>{" "}
              {!whatsapp.channelReady ? (
                <span className="text-muted-foreground">
                  el negocio todavía no eligió desde qué WhatsApp mandar los avisos.
                  {whatsapp.canConfigure && (
                    <>
                      {" "}
                      <Link href="/dashboard/settings#avisos-equipo" className="font-medium text-foreground underline underline-offset-2">
                        Elegirlo en Ajustes
                      </Link>
                    </>
                  )}
                </span>
              ) : !whatsapp.number ? (
                <span className="text-muted-foreground">
                  primero cargá tu número en{" "}
                  <Link href={`${accountTabHref("perfil")}#contacto`} className="font-medium text-foreground underline underline-offset-2">
                    Perfil
                  </Link>
                  .
                </span>
              ) : (
                <>te llegan al {whatsapp.number}.</>
              )}
            </span>
          </li>
        </ul>
      </AccountCard>

      <div className="flex min-h-5 items-center justify-between gap-3 px-1" aria-live="polite">
        <span className="text-xs">
          {error ? (
            <span role="alert" className="text-red-600 dark:text-red-400">
              {error}
            </span>
          ) : pending > 0 ? (
            <span className="text-muted-foreground">Guardando…</span>
          ) : savedOnce ? (
            <span className="text-emerald-600 dark:text-emerald-400">Guardado ✓</span>
          ) : null}
        </span>
        {hasChanges && (
          <button type="button" className={cn(secondaryButtonClass, "min-h-8 px-2.5 py-1 text-xs")} onClick={reset}>
            Restablecer valores por defecto
          </button>
        )}
      </div>

      {sections.map((section) => (
        <SectionTable key={section.key} section={section} prefs={prefs} available={available} onToggle={toggle} />
      ))}
    </div>
  );
}

function SectionTable({
  section,
  prefs,
  available,
  onToggle,
}: {
  section: NotificationsTabSection;
  prefs: StoredPrefs;
  available: Record<NotificationChannel, boolean>;
  onToggle: (eventKey: string, channel: NotificationChannel, value: boolean) => void;
}) {
  const rows = useMemo(
    () =>
      section.events.map((e) => {
        const event = eventByKey(e.key);
        return { ...e, values: event ? resolveEventPrefs(prefs, event) : { bell: true, email: false, whatsapp: false } };
      }),
    [section.events, prefs],
  );

  return (
    <section aria-labelledby={`notif-${section.key}`} className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 id={`notif-${section.key}`} className="text-sm font-semibold">
          {section.title}
        </h2>
        {/* Los nombres de las columnas, una sola vez por tabla (en el celular van con cada interruptor). */}
        <div className="hidden shrink-0 grid-cols-3 gap-2 text-center text-[11px] font-medium text-muted-foreground sm:grid" aria-hidden="true">
          {NOTIFICATION_CHANNELS.map((c) => (
            <span key={c} className="w-16">
              {CHANNEL_LABELS[c]}
            </span>
          ))}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{row.label}</p>
              <p className="text-xs text-muted-foreground">{row.description}</p>
            </div>
            <div className="grid shrink-0 grid-cols-3 gap-2">
              {NOTIFICATION_CHANNELS.map((channel) => {
                const Icon = ICONS[channel];
                const disabled = !available[channel];
                return (
                  <div key={channel} className="flex w-16 flex-col items-center gap-1 sm:flex-row sm:justify-center">
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground sm:hidden" aria-hidden="true">
                      <Icon className="h-3 w-3" />
                      {CHANNEL_LABELS[channel]}
                    </span>
                    <Switch
                      checked={!disabled && row.values[channel]}
                      disabled={disabled}
                      onChange={(value) => onToggle(row.key, channel, value)}
                      label={`${row.label}: ${CHANNEL_LABELS[channel]}`}
                    />
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
