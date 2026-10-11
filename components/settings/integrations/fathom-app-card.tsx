"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, Plug, TriangleAlert } from "lucide-react";
import { saveFathomApp } from "@/lib/actions/fathom";

/**
 * La app de Fathom del negocio (F5): Client ID y Client Secret, que se
 * guardan en Vault y NUNCA vuelven a mostrarse. Cada closer conecta SU cuenta
 * despues, desde Llamadas > Mi Fathom.
 */
export function FathomAppCard({
  hasApp,
  returnUrl,
  connected,
  withError,
}: {
  hasApp: boolean;
  /** `{APP_URL}/api/oauth/fathom/callback`, para pegar en la app de Fathom. */
  returnUrl: string;
  /** Cuantas personas tienen su Fathom conectado. */
  connected: number;
  /** Cuantas tienen la conexion caida. */
  withError: number;
}) {
  const [replacing, setReplacing] = useState(!hasApp);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saved, setSaved] = useState(hasApp);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const result = await saveFathomApp({ clientId, clientSecret });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setReplacing(false);
      // El valor no se conserva en pantalla: ni siquiera en memoria.
      setClientId("");
      setClientSecret("");
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(returnUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("No pude copiar. Seleccioná la dirección y copiala a mano.");
    }
  }

  return (
    <section aria-labelledby="fathom-app-title" className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id="fathom-app-title" className="text-sm font-semibold">Fathom (llamadas)</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Trae las llamadas de venta de tus closers desde Fathom. Cargás la app una vez; cada closer conecta su cuenta.
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            saved ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
          }`}
        >
          {saved ? <Check className="h-3 w-3" aria-hidden /> : <Plug className="h-3 w-3" aria-hidden />}
          {saved ? "App cargada" : "Falta la app"}
        </span>
      </div>

      <div className="mt-3">
        <label htmlFor="fathom-return-url" className="text-xs font-medium">Dirección de retorno (redirect URI)</label>
        <div className="mt-1 flex gap-2">
          <input
            id="fathom-return-url"
            readOnly
            value={returnUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-muted/40 px-2 text-xs"
          />
          <button type="button" onClick={copy} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs hover:bg-accent">
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copiada" : "Copiar"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Pegala tal cual como redirect URI al crear la app OAuth en Fathom.</p>
      </div>

      {replacing ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium">
            Client ID
            <input
              type="text"
              autoComplete="off"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Client Secret
            <input
              type="password"
              autoComplete="new-password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            />
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || !clientId.trim() || !clientSecret.trim()}
              className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Guardando…" : "Guardar"}
            </button>
            {hasApp || saved ? (
              <button type="button" onClick={() => setReplacing(false)} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                Cancelar
              </button>
            ) : null}
            <span className="text-[11px] text-muted-foreground">Se guardan encriptados y no se vuelven a mostrar.</span>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <p className="text-xs text-muted-foreground">El Client ID y el Secret están guardados.</p>
          <button type="button" onClick={() => setReplacing(true)} className="h-7 rounded-lg border border-border px-2 text-xs hover:bg-accent">
            Reemplazar
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs">
        <span>
          <strong>{connected}</strong> {connected === 1 ? "persona conectó" : "personas conectaron"} su Fathom
        </span>
        {withError > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <TriangleAlert className="h-3 w-3" aria-hidden />
            {withError} con error
          </span>
        )}
        <Link href="/dashboard/llamadas/mi-fathom" className="text-primary underline-offset-2 hover:underline">
          Cada closer conecta su cuenta en Llamadas &gt; Mi Fathom
        </Link>
      </div>
    </section>
  );
}
