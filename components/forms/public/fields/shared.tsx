"use client";

import { useId, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FormField } from "@/lib/forms/fields";

/**
 * Piezas comunes de los campos del formulario público. Vive en
 * `components/forms/public/` y NO importa nada de `components/forms/editor/` ni
 * del dashboard: la página pública tiene que ser liviana.
 */

export const publicInputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70";

export interface FieldProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  /** Prellenado y bloqueado: se ve, no se edita. */
  locked: boolean;
  /** Archivos elegidos (solo el campo de archivo). */
  files?: File[];
  onFiles?: (files: File[]) => void;
  /** Primera interacción de la persona con el formulario (para el "inicio"). */
  onInteract?: () => void;
}

/** La etiqueta, la ayuda y el error de un campo, con todo asociado por id. */
export function FieldShell({
  field,
  error,
  locked,
  children,
  inline,
}: {
  field: FormField;
  error?: string;
  locked: boolean;
  /** Recibe el id del control y de la descripción. */
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
  /** El control lleva su propia etiqueta (casilla de consentimiento). */
  inline?: boolean;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [field.help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      {!inline && (
        <label htmlFor={id} className="block text-sm font-medium">
          {field.label}
          {field.required && (
            <span className="ml-1 text-destructive" aria-hidden="true">
              *
            </span>
          )}
          {locked && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-amber-600">
              <Lock className="h-3 w-3" aria-hidden="true" /> Bloqueado
            </span>
          )}
        </label>
      )}
      {children({ id, describedBy })}
      {field.help && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {field.help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className={cn("text-xs text-destructive")}>
          {error}
        </p>
      )}
    </div>
  );
}
