"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setContactQualification } from "@/lib/actions/contact-qualification";
import {
  QUALIFICATION_COLORS,
  QUALIFICATION_LEVELS,
  UNQUALIFIED_LABEL,
  isQualificationLevel,
  qualificationName,
  type QualificationSettings,
} from "@/lib/contacts/qualification";
import { ActionError } from "./ui";

/**
 * El nivel de calificación del lead (00329), editable donde se lee: cinco
 * botones (1 a 5) que guardan al elegir, y «Quitar». Pasa el mouse para ver el
 * nombre y la rúbrica de cada nivel. Vive en la ficha y en el panel de la bandeja.
 */
export function QualificationField({
  contactId,
  level,
  settings,
  canEdit = true,
  onSaved,
}: {
  contactId: string;
  level: number | null;
  settings: QualificationSettings;
  canEdit?: boolean;
  /** Después de guardar (el panel de la bandeja carga sus datos en el navegador). */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const fromServer = isQualificationLevel(level) ? level : null;
  const [current, setCurrent] = useState<number | null>(fromServer);
  // Lo que viene del servidor manda: cuando cambia (se guardó, o lo cambió otro), se vuelve a mostrar eso.
  const [seen, setSeen] = useState(fromServer);
  if (fromServer !== seen) {
    setSeen(fromServer);
    setCurrent(fromServer);
  }
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(next: number | null) {
    if (next === current) return;
    const previous = current;
    setError(null);
    setCurrent(next);
    start(async () => {
      const result = await setContactQualification(contactId, next);
      if (!result.ok) {
        setCurrent(previous);
        setError(result.error);
        return;
      }
      router.refresh();
      onSaved?.();
    });
  }

  const selected = isQualificationLevel(current) ? settings.levels.find((l) => l.level === current) : null;

  return (
    <div className="text-sm">
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-label="Calificación del lead" className="flex items-center gap-1">
          {QUALIFICATION_LEVELS.map((n) => {
            const def = settings.levels.find((l) => l.level === n);
            const fill = isQualificationLevel(current) && n <= current ? QUALIFICATION_COLORS[current] : null;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={current === n}
                aria-label={`${n} · ${def?.name ?? n}`}
                title={def ? `${n} · ${def.name}${def.description ? `\n${def.description}` : ""}` : String(n)}
                disabled={pending || !canEdit}
                onClick={() => save(n)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                style={fill ? { backgroundColor: fill, borderColor: fill, color: "#fff" } : undefined}
              >
                {n}
              </button>
            );
          })}
        </div>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{qualificationName(settings, current)}</span>
        {selected?.description ? ` — ${selected.description}` : null}
        {current === null && canEdit && <span> · Elegí un nivel del 1 al 5.</span>}
      </p>
      {current !== null && canEdit && (
        <button
          type="button"
          disabled={pending}
          onClick={() => save(null)}
          className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
        >
          Quitar ({UNQUALIFIED_LABEL.toLowerCase()})
        </button>
      )}
      {error && <ActionError message={error} />}
    </div>
  );
}
