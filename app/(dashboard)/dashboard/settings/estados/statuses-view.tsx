"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowDown, ArrowLeft, ArrowUp, Check, Loader2, Pencil, Plus, RotateCcw } from "lucide-react";
import { saveContactStatusSettings } from "@/lib/actions/contact-status";
import {
  STATUS_COLORS,
  STATUS_COLOR_NAMES,
  STATUS_NAME_MAX,
  STATUS_ROLES,
  STATUS_ROLE_LABELS,
  statusDraftError,
  statusItemsMoved,
  statusItemsWithArchived,
  statusItemsWithDraft,
  type ContactStatus,
  type ContactStatusSettings,
  type StatusDraft,
  type StatusItem,
  type StatusRole,
} from "@/lib/contacts/statuses";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SaleModal } from "@/components/sales/sale-modal";
import { DialogField, fieldInput } from "@/components/content/dialog";

const ROLE_HINTS: Record<StatusRole, string> = {
  setter: "Lo mueve quien hace el primer contacto (y el agente de IA, si le habilitás la herramienta).",
  closer: "Lo mueve quien toma la llamada y cierra la venta.",
};

/**
 * Las dos listas de estados. Un estado no se borra: se archiva, y los
 * contactos que ya lo tienen lo conservan. El orden de la lista es el orden en
 * que se ofrecen en la ficha y en los filtros.
 */
export function StatusesView({
  settings,
  usage,
  usageFailed,
}: {
  settings: ContactStatusSettings;
  usage: Record<StatusRole, Record<string, number>>;
  usageFailed: boolean;
}) {
  return (
    <div className="flex h-full flex-col overflow-auto">
      <PageHeader
        route="/dashboard/settings/estados"
        backHref={
          <Link
            href="/dashboard/settings"
            aria-label="Volver a Ajustes"
            className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <SettingsTabs />
      <div className="space-y-8 px-4 py-6 md:px-8">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cada contacto tiene un estado de setter y uno de vendedor. En la ficha y en la lista se ve siempre el{" "}
          <strong className="text-foreground">último que se cambió</strong> de los dos, y cada cambio queda en el historial
          del contacto.
        </p>
        {usageFailed && (
          <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
            No pudimos contar los contactos de cada estado. Recargá la página para volver a intentarlo.
          </p>
        )}
        {STATUS_ROLES.map((role) => (
          <StatusList key={role} role={role} list={settings[role]} usage={usage[role]} />
        ))}
      </div>
    </div>
  );
}

function StatusList({ role, list, usage }: { role: StatusRole; list: ContactStatus[]; usage: Record<string, number> }) {
  const router = useRouter();
  const [draft, setDraft] = useState<StatusDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(items: StatusItem[], onOk?: () => void) {
    start(async () => {
      const result = await saveContactStatusSettings(role, items);
      if (!result.ok) {
        if (onOk) setFormError(result.error);
        else setError(result.error);
        return;
      }
      setError(null);
      setFormError(null);
      onOk?.();
      router.refresh();
    });
  }

  function save() {
    if (!draft) return;
    const invalid = statusDraftError(draft, list);
    if (invalid) return setFormError(invalid);
    run(statusItemsWithDraft(list, { ...draft, name: draft.name.trim() }), () => setDraft(null));
  }

  const label = STATUS_ROLE_LABELS[role];

  return (
    <section aria-labelledby={`status-${role}`} className="max-w-3xl">
      <div className="flex items-center gap-2">
        <h2 id={`status-${role}`} className="text-sm font-semibold">
          Estados de {label.toLowerCase()}
        </h2>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setDraft({ name: "", color: STATUS_COLORS[1] });
          }}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Estado
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{ROLE_HINTS[role]}</p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {list.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          Todavía no hay estados de {label.toLowerCase()}. Sumá el primero con «Estado».
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">Estados de {label.toLowerCase()}</caption>
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Contactos</th>
                <th scope="col" className="px-3 py-2 font-medium">Situación</th>
                <th scope="col" className="w-40 px-3 py-2">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((s, index) => (
                <tr key={s.key} className={`border-t border-border ${s.archived_at ? "text-muted-foreground" : ""}`}>
                  <td className="px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                      <span className="min-w-0 truncate font-medium">{s.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{usage[s.key] ?? 0}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.archived_at ? "bg-zinc-500/12 text-zinc-600 dark:text-zinc-300" : "bg-green-500/12 text-green-600 dark:text-green-300"
                      }`}
                    >
                      {s.archived_at ? "Archivado" : "Activo"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`Subir ${s.name}`}
                        disabled={pending || index === 0}
                        onClick={() => run(statusItemsMoved(list, s.key, -1))}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Bajar ${s.name}`}
                        disabled={pending || index === list.length - 1}
                        onClick={() => run(statusItemsMoved(list, s.key, 1))}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Editar ${s.name}`}
                        onClick={() => {
                          setFormError(null);
                          setDraft({ key: s.key, name: s.name, color: (STATUS_COLORS as readonly string[]).includes(s.color) ? (s.color as StatusDraft["color"]) : STATUS_COLORS[0] });
                        }}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      {s.archived_at ? (
                        <button
                          type="button"
                          aria-label={`Restaurar ${s.name}`}
                          disabled={pending}
                          onClick={() => run(statusItemsWithArchived(list, s.key, false))}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Archivar ${s.name}`}
                          title={(usage[s.key] ?? 0) > 0 ? "Los contactos que ya lo tienen lo conservan" : undefined}
                          disabled={pending}
                          onClick={() => run(statusItemsWithArchived(list, s.key, true))}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
                        >
                          <Archive className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <SaleModal
          title={draft.key ? "Editar estado" : `Nuevo estado de ${label.toLowerCase()}`}
          label={draft.key ? "Editar estado" : "Nuevo estado"}
          onClose={() => setDraft(null)}
          footer={
            <>
              {formError && (
                <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">
                  {formError}
                </p>
              )}
              <button type="button" onClick={() => setDraft(null)} className="ml-auto h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                Cancelar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={save}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Guardar
              </button>
            </>
          }
        >
          <DialogField label="Nombre" hint={draft.key ? "Renombrarlo cambia cómo se ve en todos los contactos que lo tienen." : undefined}>
            <input
              className={fieldInput}
              maxLength={STATUS_NAME_MAX}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={role === "setter" ? "Ej.: Calificado" : "Ej.: Propuesta enviada"}
              autoFocus
            />
          </DialogField>
          <fieldset>
            <legend className="text-xs font-medium">Color</legend>
            <div role="radiogroup" aria-label="Color del estado" className="mt-2 flex flex-wrap gap-2">
              {STATUS_COLORS.map((color) => {
                const selected = draft.color === color;
                return (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={STATUS_COLOR_NAMES[color]}
                    title={STATUS_COLOR_NAMES[color]}
                    onClick={() => setDraft({ ...draft, color })}
                    className={`grid h-8 w-8 place-items-center rounded-full ring-offset-2 ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "ring-2 ring-foreground" : ""}`}
                    style={{ backgroundColor: color }}
                  >
                    {selected && <Check className="h-4 w-4 text-white" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </SaleModal>
      )}
    </section>
  );
}
