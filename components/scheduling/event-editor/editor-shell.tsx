"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Circle } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import type { ChecklistItem, EditorSection } from "@/lib/scheduling/event-validation";
import { EDITOR_SECTIONS } from "@/lib/scheduling/editor-sections";

/**
 * El editor de un evento (F18): navegacion lateral de 7 secciones, la barra
 * con "‹ Eventos", "Vista previa" y "Guardar", y arriba la tarjeta "Listo
 * para activar" mientras el evento esta inactivo.
 */
export function EditorShell({
  eventId,
  title,
  status,
  previewUrl,
  section,
  checklist,
  canActivate,
  onActivate,
  dirty,
  saving,
  onSave,
  children,
}: {
  eventId: string;
  title: string;
  status: "active" | "hidden" | "inactive";
  previewUrl: string;
  section: EditorSection;
  checklist: ChecklistItem[];
  canActivate: boolean;
  onActivate: () => void;
  dirty: boolean;
  saving: boolean;
  onSave: (() => void) | null;
  children: ReactNode;
}) {
  const params = useSearchParams();

  // Cambiar de seccion NO va al servidor: la pagina ya trajo los datos de las
  // siete, y antes cada clic volvia a correr toda la carga del evento (unas
  // doce consultas) para mostrar otro panel. `replaceState` actualiza la URL
  // (el link sigue sirviendo para compartir o recargar) y Next mantiene
  // `useSearchParams` al dia, que es de donde la vista lee la seccion.
  function go(next: EditorSection) {
    const query = new URLSearchParams(params.toString());
    query.set("seccion", next);
    window.history.replaceState(null, "", `/dashboard/agenda/configuracion/eventos/${eventId}?${query.toString()}`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/agenda/configuracion/eventos/[id]"
        title={title}
        backHref={
          <Link href="/dashboard/agenda/configuracion/eventos" aria-label="Volver a Eventos" className="-ml-1 flex items-center gap-1 rounded-lg p-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Eventos</span>
          </Link>
        }
        right={
          <div className="flex items-center gap-2">
            {dirty && <span className="hidden text-xs text-amber-700 dark:text-amber-400 sm:inline">Cambios sin guardar</span>}
            <a href={previewUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center whitespace-nowrap rounded-lg border border-border px-3 text-sm hover:bg-muted">
              Vista previa
            </a>
            {onSave && (
              <button type="button" onClick={onSave} disabled={saving || !dirty} className="inline-flex h-9 items-center whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                Guardar
              </button>
            )}
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {status === "inactive" && (
          <section className="mb-4 rounded-xl border border-amber-300/70 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-950/30">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Listo para activar</h2>
              <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px]">Inactivo</span>
              <button type="button" onClick={onActivate} disabled={!canActivate} title={canActivate ? undefined : checklist.find((i) => i.required && !i.ok)?.reason ?? undefined} className="ml-auto rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
                Activar evento
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {checklist.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => go(item.section)}
                  title={item.reason ?? undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                    item.ok ? "border-emerald-400 text-emerald-800 dark:text-emerald-300" : item.required ? "border-amber-400" : "border-border text-muted-foreground",
                  )}
                >
                  {item.ok ? <Check className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-col gap-4 md:flex-row md:gap-8">
          <nav aria-label="Secciones del evento" className="md:w-56 md:shrink-0">
            <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
              {EDITOR_SECTIONS.map((s) => (
                <li key={s.key} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => go(s.key)}
                    aria-current={section === s.key ? "page" : undefined}
                    className={cn(
                      "block w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                      section === s.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 flex-1 space-y-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
