import { FileText, PenLine, Star, Sunset, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FORM_STATUS_LABELS, FORM_TYPE_LABELS, type FormStatus, type FormType } from "@/lib/forms/fields";

/**
 * Como se ve cada tipo y cada estado de un formulario (plano formularios-ui). Lo comparten la lista de
 * tarjetas y la barra del editor, para que el mismo tipo tenga siempre el mismo icono y color.
 * Los colores son los tokens de la app (`primary`, `c-auto`, `c-team`, `li`): sin colores nuevos.
 */
const TYPE_ICON: Record<FormType, LucideIcon> = {
  custom: FileText,
  survey: Star,
  contract: PenLine,
  eod: Sunset,
};

/** Clases completas (Tailwind genera lo que lee en el codigo): el icono, su fondo y la barra de cada tipo. */
export const FORM_TYPE_TONE: Record<FormType, { tile: string; bar: string }> = {
  custom: { tile: "bg-primary/15 text-primary", bar: "bg-primary" },
  survey: { tile: "bg-c-auto/15 text-c-auto", bar: "bg-c-auto" },
  contract: { tile: "bg-c-team/15 text-c-team", bar: "bg-c-team" },
  eod: { tile: "bg-li/15 text-li", bar: "bg-li" },
};

export function FormTypeIcon({ type, className, tooltip = false }: { type: FormType; className?: string; tooltip?: boolean }) {
  const Icon = TYPE_ICON[type];
  return (
    <span
      className={cn("grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg", FORM_TYPE_TONE[type].tile, className)}
      title={tooltip ? `Tipo: ${FORM_TYPE_LABELS[type]}` : undefined}
      aria-label={tooltip ? `Tipo: ${FORM_TYPE_LABELS[type]}` : undefined}
      aria-hidden={tooltip ? undefined : true}
      role={tooltip ? "img" : undefined}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

const STATUS_TONE: Record<FormStatus, string> = {
  published: "bg-good/15 text-good",
  draft: "bg-muted text-muted-foreground",
  paused: "bg-warn/15 text-warn",
  archived: "bg-muted text-muted-foreground/70",
};

/** El chip de estado: un punto y el nombre ("Publicado", "Borrador", "Pausado", "Archivado"). */
export function FormStatusPill({ status, className }: { status: FormStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[status], className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {FORM_STATUS_LABELS[status]}
    </span>
  );
}
