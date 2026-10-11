"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Checkbox, Notice, inputClass } from "@/components/agents/fields";
import { linkSubmissionToContact, searchContactsForForm, type ContactOption } from "@/lib/actions/forms/contact";

/**
 * Vincular a mano una respuesta sin contacto (F16): se busca el contacto, se elige y
 * se confirma. La casilla "Disparar ahora las automatizaciones" está apagada por
 * defecto; tildada dos veces dispara una sola vez (misma clave de idempotencia).
 */
export function LinkContact({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ContactOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<ContactOption | null>(null);
  const [fire, setFire] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (chosen || query.trim().length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const found = await searchContactsForForm(query);
      if (!cancelled) {
        setOptions(found);
        setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, chosen]);

  function confirm() {
    if (!chosen) return;
    setMessage(null);
    start(async () => {
      const result = await linkSubmissionToContact({ submissionId, contactId: chosen.id, fireAutomations: fire });
      if (result.ok) {
        setMessage({ tone: "success", text: "Respuesta vinculada al contacto" });
        router.refresh();
      } else {
        setMessage({ tone: "error", text: result.error });
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="vincular-titulo">
      <h2 id="vincular-titulo" className="text-sm font-semibold">
        Vincular a un contacto
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">Esta respuesta no dejó email ni teléfono, o no se pudo vincular sola. Buscá a la persona en tus contactos.</p>

      {message && (
        <div className="mt-3" role="status">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {chosen ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <span className="min-w-0 truncate">
              {chosen.name}
              {chosen.email ? <span className="ml-2 text-xs text-muted-foreground">{chosen.email}</span> : null}
            </span>
            <button type="button" onClick={() => setChosen(null)} className="text-xs underline">
              Cambiar
            </button>
          </div>
        ) : (
          <div>
            <label htmlFor="vincular-buscar" className="sr-only">
              Buscar un contacto por nombre o email
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <input id="vincular-buscar" className={`${inputClass} pl-8`} placeholder="Nombre o email del contacto" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
              {searching && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
            </div>
            {options.length > 0 && (
              <ul className="mt-1 divide-y divide-border rounded-lg border border-border" role="listbox" aria-label="Contactos encontrados">
                {options.map((option) => (
                  <li key={option.id}>
                    <button type="button" role="option" aria-selected={false} onClick={() => setChosen(option)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
                      <span className="truncate">{option.name}</span>
                      {option.email && <span className="truncate text-xs text-muted-foreground">{option.email}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim().length >= 2 && !searching && options.length === 0 && <p className="mt-1 text-xs text-muted-foreground">No encontré contactos con eso.</p>}
          </div>
        )}

        <Checkbox
          checked={fire}
          onChange={setFire}
          label="Disparar ahora las automatizaciones de este formulario"
          description="Apagada por defecto. Si la tildás, corren las automatizaciones como si la persona acabara de responder (nunca dos veces para la misma respuesta)."
        />

        <button
          type="button"
          onClick={confirm}
          disabled={!chosen || pending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Vincular
        </button>
      </div>
    </section>
  );
}
