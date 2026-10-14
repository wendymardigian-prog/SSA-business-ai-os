"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Check, Copy, Loader2, Search } from "lucide-react";
import { Notice, inputClass } from "@/components/agents/fields";
import { createSignedFormLink } from "@/lib/actions/forms/config";
import type { ContactOption } from "@/lib/actions/forms/contact";
import { useContactSearch } from "@/components/forms/use-contact-search";

/**
 * "Link para un contacto" (F20, F22): el link del formulario firmado para UNA persona.
 * Quien lo abre queda identificada sin que escriba nada, y en una encuesta con "una vez
 * por contacto" se sabe si ya respondió. Vence a los 60 días y solo sirve para ese
 * formulario.
 */
export function ContactLinkCard({ formId, published, type, children }: { formId: string; published: boolean; type: "custom" | "survey" | "contract"; children?: ReactNode }) {
  const { query, setQuery, options, searching, reset } = useContactSearch();
  const [chosen, setChosen] = useState<ContactOption | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function build(contact: ContactOption) {
    setMessage(null);
    setUrl(null);
    start(async () => {
      const result = await createSignedFormLink({ formId, contactId: contact.id });
      if (result.ok) setUrl(result.url);
      else setMessage(result.error);
    });
  }

  function copy() {
    if (!url) return;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5" aria-labelledby="link-contacto">
      <h2 id="link-contacto" className="text-sm font-semibold">
        Link para un contacto
      </h2>
      <p className="text-xs text-muted-foreground">
        {type === "contract" ? "Para mandarle el contrato a una persona: queda identificada sin escribir nada. " : type === "survey" ? "Para pedirle la opinión a una persona: queda identificada y, si la encuesta es de una vez por contacto, no puede responder dos veces. " : "Para mandar el formulario a una persona ya identificada. "}
        Vence a los 60 días y solo sirve para este formulario.
      </p>

      {!published ? (
        <Notice tone="info">Publicá el formulario para poder armar links para un contacto.</Notice>
      ) : (
        <>
          {chosen ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {chosen.name}
                {chosen.email ? <span className="ml-2 text-xs text-muted-foreground">{chosen.email}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => {
                  setChosen(null);
                  setUrl(null);
                  reset();
                }}
                className="text-xs underline"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <div>
              <label htmlFor="link-contacto-buscar" className="sr-only">
                Buscar un contacto por nombre o email
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <input id="link-contacto-buscar" className={`${inputClass} pl-8`} placeholder="Nombre o email del contacto" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
                {searching && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
              </div>
              {options.length > 0 && (
                <ul className="mt-1 divide-y divide-border rounded-lg border border-border" role="listbox" aria-label="Contactos encontrados">
                  {options.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setChosen(option);
                          build(option);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate">{option.name}</span>
                        {option.email && <span className="truncate text-xs text-muted-foreground">{option.email}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {pending && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Armando el link…
            </p>
          )}
          {message && (
            <div role="alert">
              <Notice tone="error">{message}</Notice>
            </div>
          )}
          {url && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs">{url}</code>
              <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
          )}
        </>
      )}
      {children && <div className="space-y-3 border-t border-border pt-4">{children}</div>}
    </section>
  );
}
