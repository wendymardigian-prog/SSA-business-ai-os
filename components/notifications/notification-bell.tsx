"use client";

import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationItem,
} from "@/lib/actions/notifications";
import { linkFor, relativeTime, toneFor } from "@/lib/notifications/types";

/**
 * Campana de notificaciones (F18).
 *
 * Se actualiza sola por Realtime, igual que la bandeja. La suscripcion filtra
 * por workspace, pero lo que decide que ve cada persona es la RLS: Realtime
 * respeta las policies, asi que a un Member no le llegan los avisos de leads
 * ajenos aunque el filtro del canal sea del workspace entero.
 *
 * La lista se carga al abrir el panel y no en cada render: son avisos, no
 * datos criticos, y traerlos cuando nadie los mira es gasto puro. El contador
 * si se mantiene siempre al dia, porque es lo unico que se ve cerrado.
 */

interface Props {
  workspaceId: string;
  /** Conteo calculado en el servidor: evita que el numerito parpadee al cargar. */
  initialUnread: number;
}

export function NotificationBell({ workspaceId, initialUnread }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async (withList: boolean) => {
    if (withList) setLoading(true);
    try {
      const rows = await listNotifications();
      setItems(rows);
      setUnread(rows.filter((n) => !n.readAt).length);
    } catch (err) {
      console.error("[campana] no pude traer las notificaciones:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Realtime. Mismo patron que la bandeja: createClient dentro del efecto y
  // removeChannel al desmontar.
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          // Se relee en vez de aplicar el payload: el payload viene de la fila,
          // pero si esta persona puede verla o no lo decide la RLS, y eso solo
          // lo sabe el servidor.
          void refresh(true);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, refresh]);

  // Cerrar al hacer clic afuera o con Escape.
  useEffect(() => {
    if (!open) return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items === null) void refresh(true);
  }

  function handleClick(item: NotificationItem) {
    const href = linkFor(item.entityType, item.entityId, item.metadata);

    if (!item.readAt) {
      // Optimista: el numerito baja ya, sin esperar al servidor.
      setUnread((n) => Math.max(0, n - 1));
      setItems(
        (prev) =>
          prev?.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)) ??
          prev,
      );
      startTransition(async () => {
        await markNotificationRead(item.id);
      });
    }

    setOpen(false);
    if (href) router.push(href);
  }

  function markAll() {
    setUnread(0);
    setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? prev);

    startTransition(async () => {
      const result = await markAllNotificationsRead();
      // Si fallo, se vuelve a la verdad del servidor en vez de mentir en cero.
      if (!result.ok) void refresh(true);
    });
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={
          unread > 0
            ? `Notificaciones, ${unread} sin leer`
            : "Notificaciones, ninguna sin leer"
        }
        aria-expanded={open}
        aria-haspopup="true"
        className="relative rounded-lg p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notificaciones"
          className="absolute left-0 top-full z-50 mt-2 w-80 rounded-xl border border-border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Notificaciones</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                disabled={pending}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <CheckCheck className="h-3 w-3" aria-hidden="true" />
                Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-auto">
            {loading && items === null ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            ) : !items || items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="mx-auto h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">Todo tranquilo</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Te avisamos aca cuando una conversacion necesite una persona o se caiga un canal.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleClick(item)}
                      className={`flex w-full gap-2.5 px-4 py-3 text-left transition-colors hover:bg-accent ${
                        item.readAt ? "" : "bg-primary/5"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          item.readAt
                            ? "bg-transparent"
                            : toneFor(item.type) === "warning"
                              ? "bg-amber-500"
                              : toneFor(item.type) === "success"
                                ? "bg-green-500"
                                : "bg-blue-500"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-snug">{item.title}</span>
                        {item.body && (
                          <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
                            {item.body}
                          </span>
                        )}
                        <span className="mt-1 block text-[10px] text-muted-foreground">
                          {relativeTime(item.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border px-4 py-2">
            <Link
              href="/dashboard/inbox"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Ir a la bandeja
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
