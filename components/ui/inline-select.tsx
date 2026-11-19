"use client";

import { Fragment, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import { PortalMenu, PortalMenuItem, PortalMenuSeparator } from "@/components/ui/portal-menu";
import { cn } from "@/lib/utils";

/**
 * Un valor de una tabla que se cambia ahí mismo con un desplegable (estado, responsable, activo/archivado…). Mismo
 * patrón que el Estado de la Agenda: un `PortalMenu`, que no se recorta adentro de la tabla y frena sus clics, así
 * elegir una opción no abre la fila.
 *
 * - Sin `canEdit` dibuja solo el valor, como siempre.
 * - `onSelect` llama a la acción del servidor (que vuelve a mirar el permiso). Al terminar, refresca la página; si falla,
 *   muestra el motivo al lado unos segundos y el valor queda como estaba.
 * - Una opción con `onPick` no guarda nada: hace lo suyo (por ejemplo, abrir un diálogo que pide un motivo).
 */

export type InlineSelectResult = { ok: true } | { ok: false; error: string };

export interface InlineSelectOption<V extends string> {
  value: V;
  label: string;
  /** Lo que se dibuja en la opción (por defecto, el texto). */
  render?: ReactNode;
  disabled?: boolean;
  /** Por qué está apagada. */
  hint?: string;
  /** En vez de guardar, hace esto (abrir un diálogo, por ejemplo). */
  onPick?: () => void;
  /** Dibuja una línea antes de esta opción. */
  separatorBefore?: boolean;
}

export function InlineSelect<V extends string>({
  label,
  value,
  display,
  options,
  canEdit,
  onSelect,
  width = 240,
  align = "start",
  className,
}: {
  /** El nombre accesible («Cambiar el estado del setter»). */
  label: string;
  value: V | null;
  /** Cómo se ve el valor actual en la celda (el chip, el nombre, «—»). */
  display: ReactNode;
  options: readonly InlineSelectOption<V>[];
  canEdit: boolean;
  onSelect?: (value: V) => Promise<InlineSelectResult>;
  width?: number;
  align?: "start" | "end";
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);

  if (!canEdit || options.length === 0) return <span className={className}>{display}</span>;

  function pick(option: InlineSelectOption<V>) {
    if (option.onPick) {
      option.onPick();
      return;
    }
    if (option.value === value || !onSelect) return;
    setError(null);
    start(async () => {
      try {
        const result = await onSelect(option.value);
        if (!result.ok) setError(result.error);
        else router.refresh();
      } catch {
        setError("No se pudo guardar. Probá de nuevo.");
      }
    });
  }

  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5", className)} data-row-stop="">
      <PortalMenu
        label={label}
        title={label}
        disabled={pending}
        width={width}
        align={align}
        triggerClassName="group/inline max-w-full gap-1 rounded-md px-0.5 -mx-0.5 hover:bg-accent/60 disabled:opacity-60"
        trigger={
          <>
            <span className="min-w-0 truncate">{display}</span>
            {pending ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-60 group-hover/inline:opacity-100" aria-hidden />
            )}
          </>
        }
      >
        {options.map((option) => (
          <Fragment key={option.value}>
            {option.separatorBefore && <PortalMenuSeparator />}
            <PortalMenuItem selected={option.value === value && !option.onPick} disabled={option.disabled} title={option.disabled ? option.hint : undefined} onSelect={() => pick(option)}>
              {option.render ?? <span className="truncate">{option.label}</span>}
            </PortalMenuItem>
          </Fragment>
        ))}
      </PortalMenu>
      {error && (
        <span role="alert" className="truncate text-xs text-red-700 dark:text-red-400" title={error}>
          {error}
        </span>
      )}
    </span>
  );
}
