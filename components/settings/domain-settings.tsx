"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Globe, Loader2 } from "lucide-react";
import { saveBusinessDomain } from "@/lib/actions/business-domain";

/**
 * «Dominio de tus links» (`lib/public-url.ts`): con qué dominio salen los links que ve o recibe un lead de ESTE
 * negocio (agenda, formularios, bajas, links medidos, embed, webhooks). Vacío = el dominio principal del sistema.
 *
 * El servidor comprueba que el dominio llegue a este sistema antes de guardarlo; acá solo se muestra lo que dice.
 */
export function DomainSettings({ initial, mainUrl }: { initial: string | null; mainUrl: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [current, setCurrent] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function save(next: string) {
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await saveBusinessDomain(next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCurrent(result.domain);
      setValue(result.domain ?? "");
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    });
  }

  const dirty = value.trim() !== (current ?? "");

  return (
    <section>
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Dominio de tus links</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {/* @plantilla-desde(formularios) */}
        Los links que ve un lead de este negocio (agenda, formularios, contratos, bajas de email, links medidos) salen con
        {/* @plantilla-hasta(formularios) */}
        {/* @plantilla-sin(formularios): Los links que ve un lead de este negocio (agenda, bajas de email, links medidos) salen con */}
        este dominio. Sin cargar ninguno, salen con <code>{mainUrl}</code>.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="business-domain" className="sr-only">
          Dominio de los links públicos
        </label>
        <input
          id="business-domain"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={pending}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="https://links.tuempresa.com"
          className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => save(value)}
          disabled={pending || !dirty}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {pending ? "Comprobando…" : "Guardar"}
        </button>
      </div>

      {current && !pending && (
        <button type="button" onClick={() => save("")} className="mt-2 text-xs text-muted-foreground underline hover:text-foreground">
          Volver al dominio principal
        </button>
      )}
      {saved && (
        <p className="mt-2 flex items-center gap-1 text-xs text-green-600" role="status">
          <Check className="h-3.5 w-3.5" aria-hidden /> Listo: los links nuevos ya salen con {current ?? mainUrl}.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Primero agregá el dominio en Railway (Settings → Networking → Custom Domain) y apuntá el DNS como te indica. Al
        guardar comprobamos que llegue a este sistema. Los links que ya mandaste con el dominio anterior siguen
        funcionando.
      </p>
    </section>
  );
}
