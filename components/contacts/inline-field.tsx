"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateContact } from "@/lib/actions/contacts";
import { planInlineCommit } from "@/lib/contacts/inline-edit";
import type { ContactFieldKey } from "@/lib/contacts/fields";
import { useViewerTimezone } from "@/components/dashboard-chrome";

/**
 * Un dato de la ficha que se edita DONDE SE LEE.
 *
 * Se ve como texto; con un clic (o Enter con el foco) pasa a ser un campo.
 * Enter o salir del campo guardan, Esc descarta. Guarda UN solo dato por vez
 * (`updateContact` acepta cambios parciales) y valida con las mismas funciones
 * que el servidor (`lib/contacts/inline-edit.ts`): aca para avisar mientras se
 * escribe, alla es la barrera de verdad.
 *
 * Si el dato no es valido, el campo se queda abierto con el error y lo escrito
 * intacto: perder lo que la persona acaba de tipear por un error de formato es
 * peor que el error. Un cambio que no cambia nada no llama al servidor.
 *
 * `variant="title"` es el nombre de la ficha: mismo comportamiento, tipografia
 * de titulo.
 */
export function InlineField({
  contactId,
  field,
  value,
  label,
  placeholder = "Agregar",
  hint,
  multiline = false,
  prefix,
  href,
  variant = "field",
  canEdit = true,
  onSaved,
}: {
  contactId: string;
  field: ContactFieldKey;
  /** El valor guardado, tal cual ("" si no hay). */
  value: string;
  /** Nombre del dato, para el lector de pantalla y los mensajes. */
  label: string;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  /** Se muestra antes del valor, solo al leerlo ("@" en un usuario). */
  prefix?: string;
  /** Si el valor es un link (un perfil, un correo): se dibuja como link, y se edita con el lapiz. */
  href?: string | null;
  variant?: "field" | "title";
  /** false: solo lectura (quien no puede editar este contacto). */
  canEdit?: boolean;
  /** Despues de guardar (el panel de la bandeja carga sus datos en el navegador). */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const timeZone = useViewerTimezone();
  const [editing, setEditing] = useState(false);
  // Lo que se muestra. Arranca en lo guardado (`value`) y, al guardar, pasa al valor
  // nuevo YA, sin esperar a que la pagina termine de recargar: sin esto el campo
  // volvia a mostrar el dato viejo unos segundos despues de guardar.
  const [shownValue, setShownValue] = useState(value);
  const [lastProp, setLastProp] = useState(value);
  if (value !== lastProp) {
    // La pagina recargo con el dato del servidor: manda ese.
    setLastProp(value);
    setShownValue(value);
  }
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const errorId = useId();
  // Esc descarta: marca para que el `blur` que sigue al desmontar el campo no guarde.
  const discarded = useRef(false);
  const title = variant === "title";

  function begin() {
    if (!canEdit || pending) return;
    discarded.current = false;
    setDraft(shownValue);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    discarded.current = true;
    setEditing(false);
    setError(null);
    setDraft(shownValue);
  }

  function commit() {
    if (discarded.current || pending) return;
    const plan = planInlineCommit(field, draft, shownValue, timeZone);

    if (plan.kind === "unchanged") {
      setEditing(false);
      setError(null);
      return;
    }
    if (plan.kind === "invalid") {
      setError(plan.error);
      return;
    }

    setError(null);
    start(async () => {
      const result = await updateContact(contactId, { [field]: plan.value });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setShownValue(plan.normalized);
      setEditing(false);
      router.refresh();
      onSaved?.();
    });
  }

  const inputClass = cn(
    "w-full rounded-lg border bg-background px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring",
    title ? "text-xl font-bold" : "text-sm",
    error ? "border-red-500/60" : "border-input",
  );

  if (editing) {
    const common = {
      "aria-label": label,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? errorId : undefined,
      value: draft,
      disabled: pending,
      autoFocus: true,
      onBlur: commit,
      className: inputClass,
    };
    return (
      <div className={cn("min-w-0", title && "max-w-xl")}>
        <div className="flex items-start gap-1.5">
          {multiline ? (
            <textarea
              {...common}
              rows={4}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  commit();
                }
              }}
            />
          ) : (
            <input
              {...common}
              type="text"
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
              }}
            />
          )}
          <span className="flex h-8 shrink-0 items-center gap-0.5">
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <>
                {/* mousedown y no click: el `blur` del campo corre antes y ya habria guardado/descartado. */}
                <button
                  type="button"
                  aria-label={`Guardar ${label}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit();
                  }}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Check className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Descartar el cambio de ${label}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    cancel();
                  }}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </>
            )}
          </span>
        </div>
        {error ? (
          <p id={errorId} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : (
          hint && <p className="mt-1 text-xs text-muted-foreground/70">{hint}</p>
        )}
      </div>
    );
  }

  const shown: ReactNode = shownValue ? (
    <>
      {prefix}
      {shownValue}
    </>
  ) : (
    <span className="text-muted-foreground/60 italic">{canEdit ? placeholder : "—"}</span>
  );

  // Un valor que es un link: el texto lleva al perfil y se edita con el lapiz.
  if (href && shownValue) {
    return (
      <span className="group inline-flex min-w-0 items-center gap-1.5">
        <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-sm text-primary hover:underline">
          {shown}
        </a>
        {canEdit && (
          <button
            type="button"
            onClick={begin}
            aria-label={`Editar ${label}`}
            className="rounded-md p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
          >
            <Pencil className="h-3 w-3" aria-hidden />
          </button>
        )}
      </span>
    );
  }

  if (!canEdit) {
    return <span className={cn("min-w-0 break-words", title ? "text-xl font-bold" : "text-sm")}>{shown}</span>;
  }

  return (
    <button
      type="button"
      onClick={begin}
      aria-label={`Editar ${label}${shownValue ? `: ${shownValue}` : ""}`}
      className={cn(
        "group inline-flex min-w-0 max-w-full items-start gap-1.5 rounded-md text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        title ? "text-xl font-bold" : "-mx-1.5 px-1.5 py-0.5 text-sm",
        multiline && "whitespace-pre-wrap",
      )}
    >
      <span className="min-w-0 break-words">{shown}</span>
      <Pencil
        className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden
      />
    </button>
  );
}
