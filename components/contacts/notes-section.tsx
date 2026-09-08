"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { updateContactNotes } from "@/lib/actions/contacts";
import { Section, ActionError } from "./ui";

/**
 * Notas del contacto: un solo texto compartido por el equipo.
 *
 * Se guarda con un boton y no al salir del campo. En un textarea largo, salir
 * del campo pasa todo el tiempo —cambiar de pestaña, ir a buscar un dato— y
 * guardar solo en cada uno de esos momentos convierte cualquier interrupcion
 * en un guardado a medias.
 *
 * Como el texto es uno solo para todos, se manda tambien el que estaba cargado
 * al abrir: si otra persona lo cambio mientras tanto, el servidor rechaza en
 * vez de pisarlo.
 */
export function NotesSection({
  contactId,
  notes: initial,
}: {
  contactId: string;
  notes: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, start] = useTransition();

  const dirty = value.trim() !== saved.trim();

  function save() {
    if (!dirty || pending) return;
    setError(null);

    start(async () => {
      const result = await updateContactNotes(contactId, value, saved);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(value);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
      router.refresh();
    });
  }

  return (
    <Section
      title="Notas"
      action={
        dirty ? (
          <button
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}
            Guardar
          </button>
        ) : justSaved ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3.5 w-3.5" />
            Guardado
          </span>
        ) : null
      }
    >
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          // Ctrl/Cmd+Enter guarda, como en el resto de la app.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        rows={6}
        placeholder="Lo que anotes acá lo ve todo el equipo que trabaje este contacto."
        aria-label="Notas del contacto"
        className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      {error && <div className="mt-2"><ActionError message={error} /></div>}

      {dirty && !error && (
        <p className="mt-1 text-xs text-muted-foreground/70">
          Sin guardar. Ctrl+Enter para guardar.
        </p>
      )}
    </Section>
  );
}
