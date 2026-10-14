"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ClipboardList, Copy, ExternalLink, Link2, Loader2, MoreHorizontal, Pause, Play, Plus, RotateCcw, Search, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Popover } from "@/components/ui/popover";
import { FilterMenu, MenuOption } from "@/components/ui/filter-menu";
import { Notice } from "@/components/agents/fields";
import { ContentDialog } from "@/components/content/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormStatusPill, FormTypeIcon, FORM_TYPE_TONE } from "@/components/forms/type-visual";
import { createForm, duplicateForm, setFormStatus } from "@/lib/actions/forms/forms";
import { FORM_TYPE_LABELS, FORM_TYPES, type FormType } from "@/lib/forms/fields";
import { formCardView, type FormCardView } from "@/lib/forms/form-card";
import {
  LIST_FILTERS,
  countsFor,
  filterForms,
  hasActiveFilters,
  listQueryString,
  listSummary,
  type FormListRow,
  type ListQuery,
} from "@/lib/forms/list";
import type { EodVariant } from "@/lib/eod/types";
import { cn } from "@/lib/utils";

const TYPE_HINT: Record<FormType, string> = {
  custom: "Para captar leads: aplicaciones, contacto, registros.",
  survey: "Para medir satisfacción con un NPS o estrellas.",
  contract: "Para que alguien lea, acepte y firme un contrato.",
  eod: "Para que cada persona del equipo cuente qué hizo en el día.",
};

/** Donde se recuerda lo filtrado, para que "← Volver" del editor deje la lista como estaba (solo en esta pestaña). */
export const FORMS_LIST_QUERY_KEY = "formularios-lista-query";

export function FormsList({
  rows,
  canManage,
  loadError,
  initialQuery,
  appUrl,
  timeZone,
  nowIso,
}: {
  rows: FormListRow[];
  canManage: boolean;
  loadError: boolean;
  /** Lo que dice la URL al cargar (`?q=&estado=&tipo=`), ya validado en el servidor. */
  initialQuery: ListQuery;
  appUrl: string;
  /** La zona de quien mira: "hoy 09:41", "ayer 18:20". */
  timeZone: string;
  /** El "ahora" del servidor: el mismo en el servidor y el navegador, asi "hace 2 h" no se desfasa al hidratar. */
  nowIso: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQueryState] = useState<ListQuery>(initialQuery);
  const [creating, setCreating] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<FormListRow | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Los filtros y la busqueda viven en la URL (se pueden compartir y sobreviven a recargar). Se escribe con
  // `history.replaceState`, sin ir al servidor: escribir en el buscador no vuelve a pedir la pagina.
  function setQuery(patch: Partial<ListQuery>) {
    const next = { ...query, ...patch };
    setQueryState(next);
    const qs = listQueryString(next);
    window.history.replaceState(window.history.state, "", qs ? `?${qs}` : window.location.pathname);
    try {
      sessionStorage.setItem(FORMS_LIST_QUERY_KEY, qs);
    } catch {
      // Sin almacenamiento: el "Volver" del editor deja la lista sin filtros.
    }
  }
  const clearAll = () => setQuery({ q: "", status: "all", type: "all" });

  const counts = useMemo(() => countsFor(rows), [rows]);
  const visible = useMemo(() => filterForms(rows, query), [rows, query]);
  const summary = useMemo(() => listSummary(rows, visible.length, query), [rows, visible.length, query]);
  const maxSubmissions = useMemo(() => Math.max(0, ...rows.map((r) => r.submissions)), [rows]);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const cards = useMemo(() => visible.map((row) => ({ row, view: formCardView(row, { now, timeZone, maxSubmissions }) })), [visible, now, timeZone, maxSubmissions]);

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

  const statusLabel = LIST_FILTERS.find((f) => f.value === query.status)?.label ?? "Todos";
  const typeLabel = query.type === "all" ? "Todos" : FORM_TYPE_LABELS[query.type];
  const hasFilters = hasActiveFilters(query);

  // La barra: buscador, Estado, Tipo y "+ Nuevo formulario" (solo con forms.manage). En el celular los tres
  // primeros bajan a la segunda fila de la barra, como en el resto de la app.
  const filters = (
    <>
      <SearchBox value={query.q} onChange={(q) => setQuery({ q })} />
      <FilterMenu label="Estado" value={statusLabel} active={query.status !== "all"} align="right" menuClassName="topbar:w-[250px]">
        {LIST_FILTERS.map((f) => (
          <MenuOption
            key={f.value}
            checked={query.status === f.value}
            onSelect={() => setQuery({ status: f.value })}
            leading={<StatusDot status={f.value} />}
            title={f.label}
            trailing={counts.status[f.value]}
          />
        ))}
      </FilterMenu>
      <FilterMenu label="Tipo" value={typeLabel} active={query.type !== "all"} align="right" menuClassName="topbar:w-[250px]">
        <MenuOption checked={query.type === "all"} onSelect={() => setQuery({ type: "all" })} title="Todos los tipos" trailing={counts.type.all} />
        {FORM_TYPES.map((t) => (
          <MenuOption
            key={t}
            checked={query.type === t}
            onSelect={() => setQuery({ type: t })}
            leading={<FormTypeIcon type={t} className="h-6 w-6" />}
            title={FORM_TYPE_LABELS[t]}
            trailing={counts.type[t]}
          />
        ))}
      </FilterMenu>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/formularios"
        filters={filters}
        right={
          canManage ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Nuevo formulario</span>
              <span className="sm:hidden">Nuevo</span>
            </button>
          ) : null
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-3.5">
          {message && (
            <div role="status">
              <Notice tone={message.tone}>{message.text}</Notice>
            </div>
          )}
          {loadError && (
            <div>
              <Notice tone="error">No pudimos cargar los formularios.</Notice>
              <button type="button" onClick={() => router.refresh()} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
                Reintentar
              </button>
            </div>
          )}

          {rows.length > 0 && (
            <div className="flex min-h-[26px] flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground" aria-live="polite">
              <span>{summary.text}</span>
              {summary.chips.map((chip) => (
                <span key={chip.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-1 text-[12px] text-foreground">
                  {chip.label}
                  <button
                    type="button"
                    onClick={() => setQuery(chip.id === "estado" ? { status: "all" } : chip.id === "tipo" ? { type: "all" } : { q: "" })}
                    aria-label={`Quitar el filtro ${chip.label}`}
                    className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
              {summary.filtered && (
                <button type="button" onClick={clearAll} className="font-medium text-primary hover:underline">
                  Limpiar todo
                </button>
              )}
            </div>
          )}

          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-16 text-center">
              <ClipboardList className="mb-4 h-12 w-12 text-muted-foreground/50" aria-hidden />
              <p className="text-lg font-medium text-foreground">Todavía no hay formularios</p>
              <p className="mb-4 mt-1 max-w-md text-sm text-muted-foreground">
                Creá el primero para captar leads, medir satisfacción, firmar contratos o recibir el reporte de fin de día del equipo.
              </p>
              {canManage && (
                <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                  <Plus className="h-4 w-4" aria-hidden /> Crear el primero
                </button>
              )}
            </div>
          ) : cards.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card px-5 py-11 text-center">
              <p className="text-base font-semibold">Ningún formulario coincide</p>
              <p className="mt-1 text-sm text-muted-foreground">Probá con otra búsqueda o sacá algún filtro.</p>
              <button type="button" onClick={clearAll} className="mt-4 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                Ver todos
              </button>
            </div>
          ) : (
            <ul className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(272px,1fr))]">
              {cards.map(({ row, view }) => (
                <li key={row.id} className="min-w-0">
                  <FormCard
                    view={view}
                    menu={
                      <CardMenu
                        row={row}
                        canManage={canManage}
                        onCopy={() => copyLink(row)}
                        onDuplicate={() => run(() => duplicateForm(row.id), "Duplicado como borrador")}
                        onPause={() => run(() => setFormStatus(row.id, "paused"), "Pausado")}
                        onResume={() => run(() => setFormStatus(row.id, "published"), "Reanudado")}
                        onArchive={() => setConfirmArchive(row)}
                        onRestore={() => run(() => setFormStatus(row.id, "draft"), "Restaurado como borrador")}
                      />
                    }
                  />
                </li>
              ))}
              {canManage && !hasFilters && (
                <li className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="flex min-h-[178px] w-full flex-col items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-border text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                  >
                    <span className="text-xl leading-none" aria-hidden>
                      +
                    </span>
                    Nuevo formulario
                    <small className="text-xs font-normal text-muted-foreground/80">Personalizado, encuesta, contrato o fin de día</small>
                  </button>
                </li>
              )}
            </ul>
          )}
          {pending && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Un momento…
            </p>
          )}
        </div>
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

/** El buscador de la barra: filtra mientras se escribe. Esc lo vacia. */
function SearchBox({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <label className="relative flex h-8 shrink-0 items-center">
      <span className="sr-only">Buscar formularios</span>
      <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value !== "") {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder="Buscar formularios"
        autoComplete="off"
        className="h-8 w-[150px] rounded-lg border border-input bg-background pl-8 pr-2 text-[13px] placeholder:text-muted-foreground focus:border-primary focus:outline-none topbar:w-[170px] [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  );
}

function StatusDot({ status }: { status: string }) {
  const tone = status === "published" ? "bg-good" : status === "paused" ? "bg-warn" : status === "all" ? "bg-muted-foreground/50" : "bg-muted-foreground";
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", tone)} aria-hidden />;
}

/**
 * Una tarjeta. TODA la tarjeta es un link real al editor (clic con la rueda, "abrir en pestaña nueva", Enter con
 * el foco). El menu "⋯" es un hermano del link y no un hijo: tocarlo no navega, sin trucos de eventos.
 */
function FormCard({ view, menu }: { view: FormCardView; menu: React.ReactNode }) {
  return (
    <div className="group relative h-full">
      <Link
        href={view.href}
        aria-label={`Abrir ${view.name}`}
        className={cn(
          "flex h-full min-w-0 flex-col gap-2 rounded-[14px] border border-border bg-card px-4 pb-3 pt-3.5 text-left transition-all",
          "hover:-translate-y-px hover:border-muted-foreground/50 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          view.archived && "opacity-60",
        )}
      >
        <div className="flex min-w-0 items-center gap-2 pr-8">
          <FormTypeIcon type={view.type} />
          <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">{view.typeLabel}</span>
          <FormStatusPill status={view.status} className="ml-auto" />
        </div>
        <div className="text-[15px] font-semibold leading-snug [overflow-wrap:anywhere] [text-wrap:balance]">{view.name}</div>
        <div className="truncate text-xs text-muted-foreground/80">
          {view.publicLine.kind === "different" ? (
            <>
              {view.publicLine.prefix}
              <b className="font-medium text-muted-foreground">{view.publicLine.title}</b>
            </>
          ) : (
            view.publicLine.text
          )}
        </div>
        {view.stats.kind === "live" ? (
          <>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
              <span className="text-[22px] font-semibold tabular-nums tracking-tight">{view.stats.big}</span>
              <span className="text-xs text-muted-foreground">{view.stats.unit}</span>
              {view.stats.side && <span className="ml-auto text-[11.5px] tabular-nums text-muted-foreground">{view.stats.side}</span>}
            </div>
            {view.stats.barPct !== null && (
              <div className="h-1 overflow-hidden rounded-sm bg-muted" aria-hidden>
                <div className={cn("h-full rounded-sm", FORM_TYPE_TONE[view.type].bar)} style={{ width: `${view.stats.barPct}%` }} />
              </div>
            )}
          </>
        ) : (
          <div className="py-1.5 text-[12.5px] text-muted-foreground/80">{view.stats.text}</div>
        )}
        <div className="mt-auto flex justify-between gap-2.5 border-t border-border/70 pt-2 text-[11.5px] text-muted-foreground/80">
          <span>{view.footerLeft}</span>
          <span className="shrink-0">{view.footerRight}</span>
        </div>
      </Link>
      <div className="absolute right-2.5 top-3">{menu}</div>
    </div>
  );
}

function CardMenu({
  row,
  canManage,
  onCopy,
  onDuplicate,
  onPause,
  onResume,
  onArchive,
  onRestore,
}: {
  row: FormListRow;
  canManage: boolean;
  onCopy: () => void;
  onDuplicate: () => void;
  onPause: () => void;
  onResume: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const router = useRouter();
  return (
    <Popover label={`Acciones de ${row.name}`} trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />} panelClassName="w-52 p-1" triggerClassName="grid h-[26px] w-[26px] place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground" closeOnSelect>
      <div className="flex flex-col text-sm">
        <MenuItem icon={<ExternalLink className="h-4 w-4" />} onClick={() => router.push(`/dashboard/formularios/${row.id}`)}>
          Abrir
        </MenuItem>
        {row.status === "published" && row.type !== "eod" && (
          <MenuItem icon={<Link2 className="h-4 w-4" />} onClick={onCopy}>
            Copiar link
          </MenuItem>
        )}
        {canManage && (
          <>
            <MenuItem icon={<Copy className="h-4 w-4" />} onClick={onDuplicate}>
              Duplicar
            </MenuItem>
            {row.status === "published" && (
              <MenuItem icon={<Pause className="h-4 w-4" />} onClick={onPause}>
                Pausar
              </MenuItem>
            )}
            {row.status === "paused" && (
              <MenuItem icon={<Play className="h-4 w-4" />} onClick={onResume}>
                Reanudar
              </MenuItem>
            )}
            {row.status !== "archived" ? (
              <MenuItem icon={<Archive className="h-4 w-4" />} onClick={onArchive} danger>
                Archivar
              </MenuItem>
            ) : (
              <MenuItem icon={<RotateCcw className="h-4 w-4" />} onClick={onRestore}>
                Restaurar
              </MenuItem>
            )}
          </>
        )}
      </div>
    </Popover>
  );
}

function MenuItem({ icon, onClick, children, danger = false }: { icon: React.ReactNode; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent", danger && "text-bad")}>
      <span className="text-muted-foreground" aria-hidden>
        {icon}
      </span>
      {children}
    </button>
  );
}

/** En el diálogo de crear, el EOD se presenta con su nombre completo. */
const CREATE_LABEL: Record<FormType, string> = { ...FORM_TYPE_LABELS, eod: "Reporte de fin de día" };

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FormType>("custom");
  const [variant, setVariant] = useState<EodVariant>("setter");
  const [roleLabel, setRoleLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const missingRole = type === "eod" && variant === "general" && roleLabel.trim() === "";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startSaving(async () => {
      const result = await createForm({ name, type, ...(type === "eod" ? { eod: { variant, roleLabel } } : {}) });
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
          <button type="submit" form="create-form" disabled={saving || name.trim() === "" || missingRole} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
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
                  <span className="font-medium">{CREATE_LABEL[t]}</span>
                  <span className="block text-xs text-muted-foreground">{TYPE_HINT[t]}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">El tipo no se puede cambiar después.</p>
        </fieldset>
        {type === "eod" && (
          <fieldset>
            <legend className="block text-xs font-semibold">¿Para qué rol?</legend>
            <div className="mt-1 space-y-2">
              <label className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm", variant === "setter" ? "border-primary bg-primary/5" : "border-border")}>
                <input type="radio" name="eod-variant" checked={variant === "setter"} onChange={() => setVariant("setter")} className="mt-0.5" />
                <span>
                  <span className="font-medium">Setters (con canales)</span>
                  <span className="block text-xs text-muted-foreground">Nace con la plantilla: horas, rendimiento y seis preguntas por canal en Instagram, WhatsApp y LinkedIn.</span>
                </span>
              </label>
              <label className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm", variant === "general" ? "border-primary bg-primary/5" : "border-border")}>
                <input type="radio" name="eod-variant" checked={variant === "general"} onChange={() => setVariant("general")} className="mt-0.5" />
                <span>
                  <span className="font-medium">Otro rol</span>
                  <span className="block text-xs text-muted-foreground">Solo preguntas propias, sin canales.</span>
                </span>
              </label>
            </div>
            {variant === "general" && (
              <div className="mt-3">
                <label htmlFor="eod-role-label" className="block text-xs font-semibold">
                  Nombre del rol
                </label>
                <input
                  id="eod-role-label"
                  value={roleLabel}
                  onChange={(e) => setRoleLabel(e.target.value)}
                  maxLength={40}
                  placeholder="Closer, Soporte…"
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">Esto tampoco se puede cambiar después.</p>
          </fieldset>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </ContentDialog>
  );
}
