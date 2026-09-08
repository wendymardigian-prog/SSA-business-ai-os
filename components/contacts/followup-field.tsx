"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, X } from "lucide-react";
import { updateContact } from "@/lib/actions/contacts";
import { dateInputToIso, isoToDateInput, formatDateOnly } from "@/lib/dates";
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
 * zona del negocio — con la medianoche, "15 de marzo" se guarda como el 15 a
 * las 00:00 UTC y se lee como el 14 en Argentina.
 */
export function FollowupField({
  contactId,
  value,
}: {
  contactId: string;
  value: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(nextDate: string) {
    setError(null);

    const iso = nextDate ? dateInputToIso(nextDate) : null;
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
          value={isoToDateInput(value)}
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
          Agendado para el {formatDateOnly(value)}
        </p>
      )}

      {error && <div className="mt-2"><ActionError message={error} /></div>}
    </div>
  );
}
