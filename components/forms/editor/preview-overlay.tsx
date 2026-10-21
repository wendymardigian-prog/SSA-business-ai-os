"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Eye, Monitor, Smartphone, X } from "lucide-react";
import { PublicForm } from "@/components/forms/public/public-form";
import { buildPreviewData, previewEnding, type PreviewContract } from "@/lib/forms/preview-view";
import type { FormDesign } from "@/lib/forms/defaults";
import type { FormDefinition, PublicFormType } from "@/lib/forms/fields";
import type { SuccessConfig } from "@/lib/forms/success";
import { cn } from "@/lib/utils";

/**
 * La vista previa de un formulario (plano formularios-ui, F8): pantalla completa, encima de todo, con el componente
 * publico REAL. Las preguntas condicionales reaccionan; al "enviar" muestra la pantalla final (o a donde llevaria)
 * y no manda nada. Esc la cierra y devuelve el foco a quien la abrio.
 */
export function PreviewOverlay({
  type,
  slug,
  formName,
  design,
  definition,
  success,
  contract,
  onClose,
}: {
  type: PublicFormType;
  slug: string;
  formName: string;
  design: FormDesign;
  definition: FormDefinition;
  success: SuccessConfig;
  contract?: PreviewContract | null;
  onClose: () => void;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const closeRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const data = useMemo(() => buildPreviewData({ type, slug, design, definition, contract }), [type, slug, design, definition, contract]);

  // El foco entra a la vista previa, el fondo no se desplaza y al cerrar el foco vuelve a quien la abrio.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    // El foco no sale de la vista previa: Tab da la vuelta entre el primer y el ultimo control.
    const focusable = [...(rootRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Vista previa del formulario"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[60] flex flex-col bg-background"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Eye className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 truncate text-sm">
          <span className="font-semibold">Vista previa</span>
          <span className="text-muted-foreground"> · Así lo ve quien responde · acá no se envía nada</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          <div role="group" aria-label="Tamaño de pantalla" className="hidden rounded-lg bg-muted p-0.5 sm:flex">
            {(
              [
                ["desktop", "Escritorio", Monitor],
                ["mobile", "Celular", Smartphone],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={device === value}
                onClick={() => setDevice(value)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium",
                  device === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <a
            href={`/f/${slug}?preview=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] font-medium hover:bg-accent"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Abrir en pestaña</span>
            <span className="sr-only sm:hidden">Abrir en pestaña</span>
          </a>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar la vista previa"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/30 px-4 py-8">
        <div className={cn("mx-auto w-full rounded-2xl border border-border bg-background px-6 py-8 shadow-sm", device === "mobile" ? "max-w-[390px]" : "max-w-[760px]")}>
          <PublicForm
            form={data}
            params={{}}
            mode="public_page"
            preview
            onPreviewSubmit={(answers) => previewEnding(success, { formName, answers })}
          />
        </div>
      </div>
    </div>
  );
}
