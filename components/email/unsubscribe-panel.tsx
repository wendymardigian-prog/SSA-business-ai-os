"use client";

import { useState, useTransition } from "react";
import { confirmUnsubscribe, resubscribe } from "@/lib/actions/email-unsubscribe";
import type { UnsubscribeView } from "@/lib/email/unsubscribe-public";

/**
 * Los botones de la pagina publica de baja. Lo que se muestra sale de `view` (la
 * direccion enmascarada, el estado y la marca): ningun otro dato del contacto llega
 * al navegador.
 */
export function UnsubscribePanel({ token, initial }: { token: string; initial: UnsubscribeView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [justChanged, setJustChanged] = useState(false);
  const [pending, start] = useTransition();

  function act(fn: typeof confirmUnsubscribe) {
    setError(null);
    start(async () => {
      const result = await fn(token);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setView(result.view);
      setJustChanged(true);
    });
  }

  const blocked = view.status === "bounced" || view.status === "complained";
  const out = view.status !== "subscribed";
  const button = "w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60";

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{view.brandName}</p>

      {!out && (
        <>
          <h1 className="mt-2 text-lg font-semibold">¿Querés dejar de recibir estos emails?</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Vamos a dejar de mandarle emails de novedades y promociones a <span className="font-medium text-foreground">{view.maskedAddress}</span>.
          </p>
          <button type="button" disabled={pending} onClick={() => act(confirmUnsubscribe)} className={`${button} mt-5 bg-primary text-primary-foreground hover:bg-primary/90`}>
            {pending ? "Guardando…" : "Darme de baja"}
          </button>
          {justChanged && <p className="mt-3 text-center text-sm text-muted-foreground">Listo, volviste a estar suscripto.</p>}
        </>
      )}

      {out && (
        <>
          <h1 className="mt-2 text-lg font-semibold">{justChanged ? "Listo" : "Ya no recibís estos emails"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {blocked
              ? `No le vamos a mandar más emails de novedades a ${view.maskedAddress}.`
              : `Listo, no vas a recibir más estos emails en ${view.maskedAddress}. Vas a seguir recibiendo confirmaciones de lo que pidas (agenda, compras).`}
          </p>
          {view.canResubscribe && (
            <button type="button" disabled={pending} onClick={() => act(resubscribe)} className={`${button} mt-5 border border-border bg-background hover:bg-accent`}>
              {pending ? "Guardando…" : "Me equivoqué, volver a suscribirme"}
            </button>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
