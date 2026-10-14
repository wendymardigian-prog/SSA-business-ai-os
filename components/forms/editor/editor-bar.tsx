"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BarChart3, Check, Eye, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormStatusPill, FormTypeIcon } from "@/components/forms/type-visual";
import { FORMS_LIST_QUERY_KEY } from "@/components/forms/list/forms-list";
import { publishForm } from "@/lib/actions/forms/forms";
import { editorBarView, type BarForm, type EditorRoute, type EditorSection, type SaveState } from "@/lib/forms/editor-bar";
import { cn } from "@/lib/utils";

/**
 * La barra superior del editor de un formulario y de sus pantallas hermanas (plano formularios-ui, F7): ← Volver,
 * el icono del tipo, el nombre interno editable, las pestañas, el estado, el guardado, Metricas, Vista previa y
 * Publicar. Todo va en la barra de la app: no hay una segunda barra adentro del contenido.
 *
 * Lo que decide cada cosa vive en `lib/forms/editor-bar.ts`; esto solo lo dibuja.
 */
export function EditorBar({
  form,
  route,
  section,
  canManage,
  saveState,
  name,
  onNameChange,
  onSection,
  onRetrySave,
  onReload,
  onPreview,
  onPublish,
  publishing = false,
  publishError,
  noContactsWarning,
}: {
  form: BarForm & { name: string; slug: string };
  route: EditorRoute;
  section?: EditorSection;
  canManage: boolean;
  saveState?: SaveState;
  /** El nombre que se esta editando (el del borrador). Sin esto se muestra el guardado, solo lectura. */
  name?: string;
  onNameChange?: (name: string) => void;
  /** Dentro del editor las pestañas se cambian sin recargar. Sin esto son links normales. */
  onSection?: (key: EditorSection) => void;
  onRetrySave?: () => void;
  onReload?: () => void;
  onPreview?: () => void;
  /** Publicar desde el editor (con su propio guardado, validacion y confirmacion). Sin esto, la barra publica sola. */
  onPublish?: () => void;
  publishing?: boolean;
  publishError?: string | null;
  /** El aviso de "Publicar sin contactos", para las pantallas que publican solas. */
  noContactsWarning?: string | null;
}) {
  const router = useRouter();
  const view = editorBarView(form, { canManage, route, section, saveState });
  const [ownPublishing, startPublish] = useTransition();
  const [ownError, setOwnError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const editorHref = `/dashboard/formularios/${form.id}`;
  const busy = publishing || ownPublishing;
  const error = publishError ?? ownError;

  /** En las pantallas sin borrador, publicar valida en el servidor; si falta algo, lleva a Campos. */
  function publishAlone(confirmed: boolean) {
    if (noContactsWarning && !confirmed) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setOwnError(null);
    startPublish(async () => {
      const result = await publishForm(form.id);
      if (result.ok) {
        router.refresh();
      } else if (result.reasons && result.reasons.length > 0) {
        router.push(`${editorHref}?tab=campos`);
      } else {
        setOwnError(result.error);
      }
    });
  }

  const name_ = (
    <span className="flex min-w-0 items-center gap-1.5 [flex-shrink:3]">
      <FormTypeIcon type={form.type} tooltip />
      <input
        value={name ?? form.name}
        onChange={(e) => onNameChange?.(e.target.value)}
        readOnly={!view.nameEditable}
        maxLength={120}
        aria-label="Nombre interno"
        title="Nombre interno · solo lo ve tu equipo"
        className="hidden h-8 w-[220px] min-w-[60px] max-w-full truncate rounded-lg border border-transparent bg-transparent px-2 text-[14.5px] font-semibold text-foreground hover:border-border focus:border-primary focus:bg-card focus:outline-none read-only:cursor-default read-only:hover:border-transparent topbar:block"
      />
    </span>
  );

  const tabs = (
    <nav aria-label="Secciones del formulario" className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {view.tabs.map((tab) => {
        const className = cn(
          "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[13px] font-medium transition-colors",
          tab.active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        );
        const content = (
          <>
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn("rounded-full px-1.5 text-[11px] font-semibold leading-[17px] tabular-nums", tab.active ? "bg-primary/15 text-primary" : "bg-background/70 text-muted-foreground")}>
                {tab.count.toLocaleString("es-AR")}
              </span>
            )}
          </>
        );
        if (tab.kind === "section" && onSection) {
          return (
            <a
              key={tab.key}
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              onClick={(e) => {
                // Con Ctrl, Cmd o rueda es un link normal ("abrir en pestaña nueva").
                if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                onSection(tab.key as EditorSection);
              }}
              className={className}
            >
              {content}
            </a>
          );
        }
        return (
          <Link key={tab.key} href={tab.href} aria-current={tab.active ? "page" : undefined} className={className}>
            {content}
          </Link>
        );
      })}
    </nav>
  );

  const saveBlock: ReactNode = view.save && (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px]", view.save.retry !== "none" ? "text-destructive" : view.save.state === "saved" ? "text-muted-foreground/80" : "text-muted-foreground")}
    >
      {view.save.state === "saving" || view.save.state === "pending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : view.save.state === "saved" ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
      {/* Abajo de 1360 px el guardado queda solo con su icono (el texto sigue para el lector de pantalla). */}
      <span className="max-[1359px]:sr-only">{view.save.state === "saved" ? "Guardado" : view.save.label}</span>
      {view.save.retry !== "none" && (
        <button type="button" onClick={view.save.retry === "reload" ? onReload : onRetrySave} className="font-medium underline">
          {view.save.retry === "reload" ? "Recargar" : "Reintentar"}
        </button>
      )}
    </span>
  );

  /**
   * El estado. En la computadora se va apagando cuando la barra se llena: abajo de 1600 px "Cambios sin
   * publicar" pasa a un punto ambar junto al chip (el boton ya dice "Publicar cambios") y abajo de 1100 se va el
   * chip; en el celular va entero en la segunda fila.
   */
  const statusBlock = (compact: boolean): ReactNode => (
    <>
      <FormStatusPill status={view.status.tone} className={compact ? "max-[1099px]:hidden" : undefined} />
      {view.unpublishedBadge && compact && (
        <span role="img" aria-label="Cambios sin publicar" title="Cambios sin publicar" className="h-2 w-2 shrink-0 rounded-full bg-warn min-[1600px]:hidden" />
      )}
      {view.unpublishedBadge && (
        <span
          title="Lo que editaste todavía no está en línea"
          className={cn("whitespace-nowrap rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn", compact && "max-[1599px]:hidden")}
        >
          Cambios sin publicar
        </span>
      )}
      {saveBlock}
    </>
  );

  const metrics = (
    <Link
      href={view.metrics.href}
      title="Métricas"
      aria-current={view.metrics.active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors",
        view.metrics.active ? "border-primary bg-primary/10 text-primary" : "border-input bg-background hover:border-muted-foreground/60",
      )}
    >
      <BarChart3 className="h-4 w-4" aria-hidden />
      {/* Abajo de 1500 px, Metricas queda solo con su icono (con tooltip). */}
      <span className="max-[1499px]:sr-only">Métricas</span>
    </Link>
  );

  const publish = view.publish;
  const publishButton =
    publish.kind === "none" ? null : publish.kind === "published" ? (
      <span title="Lo que ves es lo que está en línea" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-input px-2.5 text-[13px] font-medium text-good">
        <Check className="h-4 w-4" aria-hidden />
        Publicado
      </span>
    ) : (
      <button
        type="button"
        onClick={onPublish ?? (() => publishAlone(false))}
        disabled={busy}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {publish.label}
      </button>
    );

  const previewButton = view.showPreview && onPreview && (
    <button
      type="button"
      onClick={onPreview}
      title="Vista previa"
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-[13px] font-medium hover:border-muted-foreground/60"
    >
      <Eye className="h-4 w-4" aria-hidden />
      <span className="hidden min-[1320px]:inline">Vista previa</span>
      <span className="sr-only min-[1320px]:hidden">Vista previa</span>
    </button>
  );

  return (
    <>
      <PageHeader
        route="/dashboard/formularios"
        title={form.name}
        backHref={<BackToList />}
        titleSlot={name_}
        tabs={tabs}
        tabsExtra={
          <div className="flex shrink-0 items-center gap-2 pl-1">
            {metrics}
            {statusBlock(false)}
          </div>
        }
        right={
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-2 topbar:flex">
              {statusBlock(true)}
              {metrics}
            </div>
            {previewButton}
            {publishButton}
            {error && (
              <span role="alert" title={error} className="hidden max-w-[220px] truncate text-xs text-destructive topbar:inline">
                {error}
              </span>
            )}
          </div>
        }
      />
      <ConfirmDialog
        open={confirming}
        title="Publicar sin contactos"
        message={noContactsWarning ?? ""}
        confirmLabel="Publicar igual"
        cancelLabel="Ir a Contacto"
        onConfirm={() => publishAlone(true)}
        onCancel={() => {
          setConfirming(false);
          router.push(`${editorHref}?tab=contacto`);
        }}
      />
    </>
  );
}

/**
 * "← Volver" a la lista, que queda con los filtros que tenia (se guardan en esta pestaña del navegador). Se leen al hacer
 * clic; con Ctrl, Cmd o la rueda es un link normal a la lista sin filtros.
 */
function BackToList() {
  const router = useRouter();
  return (
    <Link
      href="/dashboard/formularios"
      aria-label="Volver a Formularios"
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        let saved = "";
        try {
          saved = sessionStorage.getItem(FORMS_LIST_QUERY_KEY) ?? "";
        } catch {
          // sin almacenamiento: la lista sin filtros
        }
        if (saved) {
          e.preventDefault();
          router.push(`/dashboard/formularios?${saved}`);
        }
      }}
      className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
    </Link>
  );
}
