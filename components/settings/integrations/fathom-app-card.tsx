"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, Plug, TriangleAlert } from "lucide-react";
import { saveFathomApp } from "@/lib/actions/fathom";

/**
 * La app de Fathom del negocio (F5): Client ID y Client Secret, que se
 * guardan en Vault y NUNCA vuelven a mostrarse. Cada closer conecta SU cuenta
 * despues, desde Llamadas > Mi Fathom.
 *
 * Se ve como las demas tarjetas de integracion (nombre y estado, una linea de
 * descripcion y un boton) y vive junto a ellas, en "Conexiones". Los campos NO
 * ocupan lugar hasta que se aprieta "Conectar": se despliegan debajo, y al
 * guardar o cancelar vuelven a esconderse.
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
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saved, setSaved] = useState(hasApp);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function close() {
    setOpen(false);
    setError(null);
    // El valor no se conserva en pantalla: ni siquiera en memoria.
    setClientId("");
    setClientSecret("");
  }

  function save() {
    setError(null);
    start(async () => {
      const result = await saveFathomApp({ clientId, clientSecret });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      close();
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
    <section aria-labelledby="fathom-app-title" className="flex h-full flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 id="fathom-app-title" className="text-sm font-semibold">Fathom (llamadas)</h3>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            saved ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
          }`}
        >
          {saved ? <Check className="h-3 w-3" aria-hidden /> : <Plug className="h-3 w-3" aria-hidden />}
          {saved ? "Conectado" : "Sin conectar"}
        </span>
      </div>

      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
        Trae las llamadas de venta de tus closers desde Fathom. Cargás la app una vez; cada closer conecta su cuenta.
      </p>

      {saved && (
        <p className="mt-2 text-xs">
          <strong>{connected}</strong> {connected === 1 ? "persona conectó" : "personas conectaron"} su Fathom
          {withError > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <TriangleAlert className="h-3 w-3" aria-hidden />
              {withError} con error
            </span>
          )}
        </p>
      )}

      {/* Los campos solo existen despues de tocar "Conectar": sin esto la tarjeta reservaba una zona grande para nada. */}
      {open && (
        <div id={panelId} className="mt-3 space-y-3 border-t border-border pt-3">
          <div>
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
          <label className="block text-xs font-medium">
            Client ID
            <input
              type="text"
              autoComplete="off"
              autoFocus
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            />
          </label>
          <label className="block text-xs font-medium">
            Client Secret
            <input
              type="password"
              autoComplete="new-password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || !clientId.trim() || !clientSecret.trim()}
              className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" onClick={close} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent">
              Cancelar
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">Se guardan encriptados y no se vuelven a mostrar.</p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>
      )}

      {/* El boton siempre abajo, igual que en las demas tarjetas. */}
      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className="flex h-9 w-full items-center justify-center rounded-lg border border-border text-sm font-medium hover:bg-accent"
        >
          {open ? "Cerrar" : saved ? "Reemplazar claves" : "Conectar"}
        </button>
        {saved && (
          <Link href="/dashboard/llamadas/mi-fathom" className="mt-2 block text-center text-[11px] text-primary underline-offset-2 hover:underline">
            Cada closer conecta su cuenta en Llamadas &gt; Mi Fathom
          </Link>
        )}
      </div>
    </section>
  );
}
