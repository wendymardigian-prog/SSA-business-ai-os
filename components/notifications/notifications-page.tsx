"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, Check, CheckCheck, CheckCircle2, ListTodo, MessageCircle, Video, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TopbarTabs } from "@/components/ui/topbar-tabs";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { markAllNotificationsRead, markNotificationRead, type NotificationItem, type NotificationsPageData } from "@/lib/actions/notifications";
import { linkFor, relativeTime } from "@/lib/notifications/types";
import {
  NOTIFICATION_VIEWS,
  NOTIFICATION_VIEW_LABELS,
  emptyViewText,
  notificationBusiness,
  notificationVisual,
  notificationsHref,
  shortAgo,
  unreadPillText,
  type NotificationHue,
  type NotificationIcon,
  type NotificationView,
} from "@/lib/notifications/page-view";
import { Tip } from "@/components/ui/tooltip";

/**
 * Notificaciones a pantalla completa (traída de RER-BAIOS, con el estilo de SSA).
 *
 * En la barra: «N sin leer», las pestañas «No leídas · Todas · Leídas» (siempre se entra por las no leídas) y
 * «Marcar todas como leídas». Abajo, la lista a todo el ancho: punto de no leída, ícono por tipo, título y texto,
 * el negocio del cliente y la hora, y el check para marcarla leída sin abrirla. Páginas de 50. Mismo alcance que la
 * campana (lo propio y lo general, sin lo silenciado) y se actualiza sola por Realtime, como la campana.
 */

const ICONS: Record<NotificationIcon, LucideIcon> = {
  meeting: Video,
  message: MessageCircle,
  task: ListTodo,
  alert: AlertTriangle,
  done: CheckCircle2,
  bell: Bell,
};

const HUES: Record<NotificationHue, string> = {
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  yellow: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  green: "bg-green-500/15 text-green-700 dark:text-green-400",
  neutral: "bg-muted text-muted-foreground",
};

export function NotificationsPage({ workspaceId, view, page, data }: { workspaceId: string; view: NotificationView; page: number; data: NotificationsPageData }) {
  const router = useRouter();
  const viewerTimezone = useViewerTimezone();
  const [pending, startTransition] = useTransition();
  // Leídas en esta pantalla mientras el servidor confirma: la fila cambia ya.
  const [readNow, setReadNow] = useState<Set<string>>(() => new Set());
  const [allRead, setAllRead] = useState(false);

  // Con datos nuevos del servidor, lo optimista ya no hace falta (se reinicia al dibujar, sin efecto).
  const [seenData, setSeenData] = useState(data);
  if (seenData !== data) {
    setSeenData(data);
    setReadNow(new Set());
    setAllRead(false);
  }

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications-page-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `workspace_id=eq.${workspaceId}` }, () => router.refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, router]);

  const isRead = (n: NotificationItem) => allRead || readNow.has(n.id) || !!n.readAt;
  const readHere = data.items.filter((n) => !n.readAt && readNow.has(n.id)).length;
  const unread = allRead ? 0 : Math.max(0, data.counts.unread - readHere);
  const pill = unreadPillText(unread);

  function markRead(n: NotificationItem) {
    if (isRead(n)) return;
    setReadNow((prev) => new Set(prev).add(n.id));
    startTransition(async () => {
      await markNotificationRead(n.id);
      router.refresh();
    });
  }

  function open(n: NotificationItem) {
    const href = linkFor(n.entityType, n.entityId, n.metadata);
    markRead(n);
    if (href) router.push(href);
  }

  function markAll() {
    setAllRead(true);
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      // Si falló, se vuelve a la verdad del servidor en vez de mentir en cero.
      if (!result.ok) setAllRead(false);
      router.refresh();
    });
  }

  // Solo «No leídas» lleva número: es lo pendiente (las otras dos son historial).
  const tabs = NOTIFICATION_VIEWS.map((v) => ({
    key: v,
    label: NOTIFICATION_VIEW_LABELS[v],
    href: notificationsHref(v),
    count: v === "no-leidas" ? unread : null,
    countLabel: v === "no-leidas" ? "sin leer" : undefined,
  }));
  const empty = emptyViewText(view);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/notificaciones"
        left={pill ? <span className="hidden whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground sm:inline-flex">{pill}</span> : null}
        tabs={<TopbarTabs label="Qué avisos ver" active={view} tabs={tabs} />}
        primary={
          <Tip content="Marcar todas como leídas">
            <button
              type="button"
              onClick={markAll}
              disabled={pending || unread === 0}
              aria-label="Marcar todas como leídas"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
            >
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Marcar todas como leídas</span>
            </button>
          </Tip>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-4 px-4 py-4 md:px-8 md:py-6">
          <section aria-label={NOTIFICATION_VIEW_LABELS[view]} className="overflow-hidden rounded-xl border border-border bg-card">
            {data.items.length === 0 ? (
              <div className="px-4 py-16 text-center">
                <Bell className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">{empty.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{empty.body}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data.items.map((n) => {
                  const read = isRead(n);
                  const { icon, hue } = notificationVisual(n.entityType, n.type);
                  const Icon = ICONS[icon];
                  const business = notificationBusiness(n.metadata);
                  const href = linkFor(n.entityType, n.entityId, n.metadata);
                  return (
                    <li key={n.id} className={cn("flex items-center gap-2 pr-2 transition-colors hover:bg-accent/60 md:pr-4", !read && "bg-primary/5")}>
                      <Tip asChild content={href ? null : "Este aviso no lleva a ninguna pantalla"}>
                        <button
                          type="button"
                          onClick={() => open(n)}
                          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left md:pl-4"
                          aria-label={`${n.title}${read ? "" : " (sin leer)"}`}
                        >
                          <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", read ? "bg-transparent" : "bg-red-500")} />
                          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", HUES[hue])} aria-hidden="true">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cn("block text-sm sm:truncate", read ? "font-medium text-foreground/80" : "font-semibold")}>{n.title}</span>
                            {n.body && <span className="block line-clamp-2 text-xs text-muted-foreground sm:line-clamp-1">{n.body}</span>}
                          </span>
                          <span className="shrink-0 text-right text-xs leading-5 text-muted-foreground">
                            {business && <span className="hidden max-w-40 truncate sm:block">{business}</span>}
                            <Tip asChild content={relativeTime(n.createdAt)}>
                              <span className="block tabular-nums" suppressHydrationWarning>
                                {shortAgo(n.createdAt, new Date(), viewerTimezone)}
                              </span>
                            </Tip>
                          </span>
                        </button>
                      </Tip>
                      {/* Sin asChild: ya leída, el botón queda apagado y no recibe el puntero. */}
                      <Tip content={read ? "Ya está leída" : "Marcar como leída"} className="flex shrink-0">
                        <button
                          type="button"
                          onClick={() => markRead(n)}
                          disabled={read}
                          aria-label={read ? "Ya está leída" : `Marcar como leída: ${n.title}`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 md:h-9 md:w-9"
                        >
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </Tip>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {(page > 1 || data.hasMore) && (
            <nav aria-label="Páginas" className="flex items-center justify-end gap-2 text-sm">
              {page > 1 && (
                <Link href={notificationsHref(view, page - 1)} className="rounded-lg border border-border px-3 py-1.5 hover:bg-accent">
                  Más recientes
                </Link>
              )}
              {data.hasMore && (
                <Link href={notificationsHref(view, page + 1)} className="rounded-lg border border-border px-3 py-1.5 hover:bg-accent">
                  Anteriores
                </Link>
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
