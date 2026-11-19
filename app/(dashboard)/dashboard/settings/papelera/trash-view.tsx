"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { restoreFromTrash } from "@/lib/actions/trash";
import { daysLeft, trashPluralOf, TRASH_RETENTION_DAYS, type AnyTrashEntity } from "@/lib/trash/entities";
import type { TrashListItem } from "@/lib/trash/types";

/** La lista de la Papelera: filtrar por tipo y restaurar. */
export function TrashView({ items, error, names }: { items: TrashListItem[]; error: string | null; names: Record<string, string> }) {
  const router = useRouter();
  const timeZone = useViewerTimezone();
  const [type, setType] = useState<AnyTrashEntity | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [, start] = useTransition();

  const types = useMemo(() => Array.from(new Set(items.map((i) => i.entity))).sort((a, b) => trashPluralOf(a).localeCompare(trashPluralOf(b), "es")), [items]);
  const shown = type === "all" ? items : items.filter((i) => i.entity === type);
  const when = (iso: string) =>
    new Intl.DateTimeFormat("es", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  function restore(item: TrashListItem) {
    setBusy(item.id);
    start(async () => {
      const r = await restoreFromTrash(item.id);
      setBusy(null);
      setMessages((m) => ({ ...m, [item.id]: r.ok ? { ok: true, text: "Restaurado." } : { ok: false, text: r.error } }));
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <PageHeader
        tabs={<SettingsTabs />}
        route="/dashboard/settings/papelera"
        backHref={
          <Link href="/dashboard/settings" aria-label="Volver a Ajustes" className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <div className="space-y-5 px-4 py-6 md:px-8">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Lo que se eliminó en los últimos {TRASH_RETENTION_DAYS} días. Desapareció de todas las pantallas y números; desde acá se puede
          restaurar tal como estaba. Pasado ese plazo se borra solo y para siempre. Solo ves los tipos de registro que podés eliminar.
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>
        )}

        {items.length > 0 && (
          <label className="flex max-w-xs flex-col gap-1 text-xs text-muted-foreground">
            Tipo
            <select className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground" value={type} onChange={(e) => setType(e.target.value as AnyTrashEntity | "all")}>
              <option value="all">Todos ({items.length})</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {trashPluralOf(t)} ({items.filter((i) => i.entity === t).length})
                </option>
              ))}
            </select>
          </label>
        )}

        {items.length === 0 ? (
          error ? null : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-12 text-center">
            <Trash2 className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">La Papelera está vacía</p>
            <p className="max-w-sm text-xs text-muted-foreground">Cuando elimines una venta, un pago, una agenda u otro registro, va a aparecer acá durante {TRASH_RETENTION_DAYS} días.</p>
          </div>
          )
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {shown.map((item) => {
              const left = daysLeft(item.expiresAt);
              const msg = messages[item.id];
              const restored = msg?.ok === true;
              return (
                <li key={item.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs text-muted-foreground">{trashPluralOf(item.entity)}</p>
                    <p className="break-words text-sm font-medium">{item.label}</p>
                    {item.alsoDeleted.length > 0 && <p className="text-xs text-muted-foreground">Con {item.alsoDeleted.join(", ")}</p>}
                    <p className="text-xs text-muted-foreground">
                      Eliminado {when(item.deletedAt)}
                      {item.deletedBy && names[item.deletedBy] ? ` por ${names[item.deletedBy]}` : ""} · {left === 1 ? "queda 1 día" : `quedan ${left} días`}
                    </p>
                    {msg && (
                      <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs text-emerald-700 dark:text-emerald-400" : "text-xs text-red-700 dark:text-red-400"}>
                        {msg.text}
                      </p>
                    )}
                  </div>
                  {!restored && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => restore(item)}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50 sm:self-auto"
                    >
                      {busy === item.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />} Restaurar
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
