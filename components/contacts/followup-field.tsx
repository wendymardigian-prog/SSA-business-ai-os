"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, X } from "lucide-react";
import { updateContact } from "@/lib/actions/contacts";
import { dateInputToIso, isoToDateInput, formatDateOnly } from "@/lib/dates";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { FollowupTask } from "@/components/tasks/followup-task"; // @plantilla-quitar(tareas)
import { ActionError } from "./ui";

/**
 * Fecha del proximo seguimiento, editable donde se lee.
 *
 * El campo ya era editable, pero solo adentro del formulario de "Editar",
 * mezclado entre quince campos, mientras esta seccion lo mostraba en solo
 * lectura. Parecia que no se podia tocar.
 *
 * Es una fecha sin hora a proposito: nadie agenda un seguimiento a las 14:35.
 * La columna es timestamptz, asi que el dia elegido se ancla al mediodia de la
 * zona de quien lo guarda — con la medianoche, "15 de marzo" se guarda como
 * el 15 a las 00:00 UTC y se lee como el 14 en una zona mas atrasada.
 */
export function FollowupField({
  contactId,
  value,
  onSaved,
  canCreateTask, // @plantilla-quitar(tareas)
  contactName,
}: {
  contactId: string;
  value: string | null;
  /** Despues de guardar (el panel de la bandeja carga sus datos en el navegador). */
  onSaved?: () => void;
  /**  @plantilla-quitar(tareas)
   * Tareas × CRM (R2): si se puede mostrar «Crear tarea» debajo de la fecha. Opcional: sin esto se usa el permiso de  @plantilla-quitar(tareas)
   * editar tareas del anfitrion de tareas (`ContactTasksProvider`); sin anfitrion, el campo es el de siempre.  @plantilla-quitar(tareas)
   * @plantilla-quitar(tareas) */
  canCreateTask?: boolean; // @plantilla-quitar(tareas)
  /** Para el texto del boton «Crear tarea» (lo lee el lector de pantalla).  @plantilla-quitar(tareas) */
  contactName?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timeZone = useViewerTimezone();

  function save(nextDate: string) {
    setError(null);

    const iso = nextDate ? dateInputToIso(nextDate, timeZone) : null;
    if (nextDate && !iso) {
      setError("Esa fecha no es válida");
      return;
    }

    start(async () => {
      const result = await updateContact(contactId, { next_followup_date: iso ?? "" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <label
        htmlFor="followup-date"
        className="flex items-center gap-2 text-muted-foreground"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        Próximo seguimiento
        {pending && <Loader2 className="h-3 w-3 animate-spin" />}
      </label>

      <div className="mt-2 flex items-center gap-2">
        <input
          id="followup-date"
          type="date"
          value={isoToDateInput(value, timeZone)}
          onChange={(e) => save(e.target.value)}
          disabled={pending}
          className="flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        {value && (
          <button
            onClick={() => save("")}
            disabled={pending}
            aria-label="Quitar la fecha de seguimiento"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {value && !error && (
        <p className="mt-1.5 text-xs text-muted-foreground/70">
          Agendado para el {formatDateOnly(value, timeZone)}
        </p>
      )}

      {error && <div className="mt-2"><ActionError message={error} /></div>}

      {/* @plantilla-desde(tareas) */}
      <FollowupTask contactId={contactId} contactName={contactName} followupValue={value} canCreateTask={canCreateTask} />
      {/* @plantilla-hasta(tareas) */}
    </div>
  );
}
