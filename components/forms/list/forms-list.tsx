"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ClipboardList, Copy, ExternalLink, Link2, Loader2, MoreHorizontal, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Popover } from "@/components/ui/popover";
import { Notice } from "@/components/agents/fields";
import { ContentDialog } from "@/components/content/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { createForm, duplicateForm, setFormStatus } from "@/lib/actions/forms/forms";
import { FORM_STATUS_LABELS, FORM_TYPE_LABELS, FORM_TYPES, type FormStatus, type FormType } from "@/lib/forms/fields";
import { LIST_FILTERS, countByStatus, parseListFilter, type FormListRow, type ListFilter } from "@/lib/forms/list";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<FormStatus, string> = {
  draft: "border-border text-muted-foreground",
  published: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  paused: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  archived: "border-border bg-muted text-muted-foreground",
};

const TYPE_HINT: Record<FormType, string> = {
  custom: "Para captar leads: aplicaciones, contacto, registros.",
  survey: "Para medir satisfacción con un NPS o estrellas.",
  contract: "Para que alguien lea, acepte y firme un contrato.",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

export function FormsList({
  rows,
  canManage,
  loadError,
  initialFilter,
  appUrl,
}: {
  rows: FormListRow[];
  canManage: boolean;
  loadError: boolean;
  initialFilter?: string;
  appUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<ListFilter>(parseListFilter(initialFilter));
  const [creating, setCreating] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<FormListRow | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const counts = useMemo(() => countByStatus(rows), [rows]);
  const visible = rows.filter((r) => r.status === filter);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setMessage({ tone: "success", text: success });
        router.refresh();
      } else {
        setMessage({ tone: "error", text: result.error ?? "No se pudo completar la acción. Probá de nuevo." });
      }
    });
  }

  function copyLink(row: FormListRow) {
    const url = `${appUrl || window.location.origin}/f/${row.slug}`;
    void navigator.clipboard?.writeText(url).then(
      () => setMessage({ tone: "success", text: "Link copiado" }),
      () => setMessage({ tone: "error", text: "No pude copiar el link. Copialo desde la pestaña Publicar." }),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/formularios"
        right={
          canManage ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Nuevo formulario</span>
              <span className="sm:hidden">Nuevo</span>
            </button>
          ) : null
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {message && (
          <div className="mb-3" role="status">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
        {loadError && (
          <div className="mb-3">
            <Notice tone="error">No pudimos cargar los formularios.</Notice>
            <button type="button" onClick={() => router.refresh()} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
              Reintentar
            </button>
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
          {LIST_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f.value ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label} · {counts[f.value]}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border py-16 text-center">
            <ClipboardList className="mb-4 h-12 w-12 text-muted-foreground/50" aria-hidden />
            <p className="text-lg font-medium text-muted-foreground">Todavía no hay formularios</p>
            <p className="mb-4 mt-1 max-w-md text-sm text-muted-foreground">Creá el primero para captar leads, medir satisfacción o firmar contratos.</p>
            {canManage && (
              <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4" aria-hidden /> Crear el primero
              </button>
            )}
          </div>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No hay formularios {LIST_FILTERS.find((f) => f.value === filter)?.label.toLowerCase()}.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((row) => (
              <li key={row.id} className="group relative flex items-center gap-4 rounded-lg border bg-card px-4 py-4 transition-shadow hover:shadow-md">
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <button type="button" onClick={() => router.push(`/dashboard/formularios/${row.id}`)} className="flex min-w-0 items-center gap-2 text-left focus:outline-none focus-visible:underline">
                    <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate font-medium">{row.name}</span>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{FORM_TYPE_LABELS[row.type]}</span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", STATUS_STYLE[row.status])}>{FORM_STATUS_LABELS[row.status]}</span>
                  </div>
                </div>

                <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                  <div>
                    <span className="font-medium text-foreground">{row.submissions}</span> {row.submissions === 1 ? "envío" : "envíos"}
                  </div>
                  <div>Último: {formatDate(row.lastSubmissionAt)}</div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground sm:hidden">{row.submissions} env.</div>

                <Popover label={`Acciones de ${row.name}`} trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />} panelClassName="w-52 p-1" triggerClassName="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" closeOnSelect>
                  <div className="flex flex-col text-sm">
                    <MenuItem icon={<ExternalLink className="h-4 w-4" />} onClick={() => router.push(`/dashboard/formularios/${row.id}`)}>
                      Abrir
                    </MenuItem>
                    {row.status === "published" && (
                      <MenuItem icon={<Link2 className="h-4 w-4" />} onClick={() => copyLink(row)}>
                        Copiar link
                      </MenuItem>
                    )}
                    {canManage && (
                      <>
                        <MenuItem icon={<Copy className="h-4 w-4" />} onClick={() => run(() => duplicateForm(row.id), "Duplicado como borrador")}>
                          Duplicar
                        </MenuItem>
                        {row.status === "published" && (
                          <MenuItem icon={<Pause className="h-4 w-4" />} onClick={() => run(() => setFormStatus(row.id, "paused"), "Pausado")}>
                            Pausar
                          </MenuItem>
                        )}
                        {row.status === "paused" && (
                          <MenuItem icon={<Play className="h-4 w-4" />} onClick={() => run(() => setFormStatus(row.id, "published"), "Reanudado")}>
                            Reanudar
                          </MenuItem>
                        )}
                        {row.status !== "archived" ? (
                          <MenuItem icon={<Archive className="h-4 w-4" />} onClick={() => setConfirmArchive(row)}>
                            Archivar
                          </MenuItem>
                        ) : (
                          <MenuItem icon={<RotateCcw className="h-4 w-4" />} onClick={() => run(() => setFormStatus(row.id, "draft"), "Restaurado como borrador")}>
                            Restaurar
                          </MenuItem>
                        )}
                      </>
                    )}
                  </div>
                </Popover>
              </li>
            ))}
          </ul>
        )}
        {pending && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Un momento…
          </p>
        )}
      </div>

      {creating && <CreateDialog onClose={() => setCreating(false)} onCreated={(id) => router.push(`/dashboard/formularios/${id}`)} />}

      <ConfirmDialog
        open={!!confirmArchive}
        title="¿Archivar este formulario?"
        message={`"${confirmArchive?.name ?? ""}" deja de recibir respuestas. Las respuestas ya recibidas se conservan y podés restaurarlo cuando quieras.`}
        confirmLabel="Archivar"
        cancelLabel="Cancelar"
        destructive
        onCancel={() => setConfirmArchive(null)}
        onConfirm={() => {
          const row = confirmArchive;
          setConfirmArchive(null);
          if (row) run(() => setFormStatus(row.id, "archived"), "Archivado");
        }}
      />
    </div>
  );
}

function MenuItem({ icon, onClick, children }: { icon: React.ReactNode; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent">
      <span className="text-muted-foreground" aria-hidden>
        {icon}
      </span>
      {children}
    </button>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FormType>("custom");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startSaving(async () => {
      const result = await createForm({ name, type });
      if (result.ok) onCreated(result.id);
      else setError(result.error);
    });
  }

  return (
    <ContentDialog
      title="Nuevo formulario"
      label="Nuevo formulario"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
            Cancelar
          </button>
          <button type="submit" form="create-form" disabled={saving || name.trim() === ""} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Crear
          </button>
        </div>
      }
    >
      <form id="create-form" onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="form-name" className="block text-xs font-semibold">
            Nombre
          </label>
          <input
            id="form-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Aplicación al programa"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <fieldset>
          <legend className="block text-xs font-semibold">Tipo</legend>
          <div className="mt-1 space-y-2">
            {FORM_TYPES.map((t) => (
              <label key={t} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm", type === t ? "border-primary bg-primary/5" : "border-border")}>
                <input type="radio" name="form-type" value={t} checked={type === t} onChange={() => setType(t)} className="mt-0.5" />
                <span>
                  <span className="font-medium">{FORM_TYPE_LABELS[t]}</span>
                  <span className="block text-xs text-muted-foreground">{TYPE_HINT[t]}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">El tipo no se puede cambiar después.</p>
        </fieldset>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </ContentDialog>
  );
}
