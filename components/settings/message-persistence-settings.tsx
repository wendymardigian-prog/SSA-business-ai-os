"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateMessagePersistence } from "@/lib/actions/workspace";

/**
 * Guardado local de los mensajes entrantes de Instagram.
 *
 * El interruptor existe por una razon concreta y el texto tiene que decirla:
 * guardar el contenido de los DMs es lo que necesitan el agente de IA y los
 * dashboards, pero queda por confirmar si entra dentro de los terminos de
 * Zernio y de Meta. Hasta entonces tiene que poder apagarse en el momento.
 *
 * Se avisa ademas que apagarlo no borra lo ya guardado, porque es exactamente
 * lo que uno supondria y no es asi.
 */
export function MessagePersistenceSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(value: boolean) {
    start(async () => {
      const result = await updateMessagePersistence(value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Guardado de mensajes</h2>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="mt-4 space-y-3">
        <label
          className={cn(
            "flex cursor-pointer gap-3 rounded-lg border border-border p-3 transition-colors",
            pending ? "cursor-not-allowed opacity-60" : "hover:bg-accent/40",
          )}
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(e) => toggle(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-shrink-0 accent-current"
          />
          <span>
            <span className="block text-sm font-medium">
              Guardar los mensajes entrantes de Instagram
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Se guarda una copia de cada DM que entra: el texto, los datos del mensaje y el
              enlace a la imagen o el video (nunca el archivo). Es lo que le permite al agente
              de IA leer el historial y a los dashboards contar los mensajes. La bandeja sigue
              mostrando el hilo tal como lo trae Instagram, así que prender o apagar esto no
              cambia lo que ves en las conversaciones.
            </span>
          </span>
        </label>

        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {enabled ? (
            <>
              Los mensajes guardados se borran solos a los 12 meses. Si apagás esta opción,
              se deja de guardar de ahí en adelante, pero lo ya guardado <strong>no</strong> se
              borra: para eso hay que correr la purga (
              <code className="font-mono">scripts/purge-zernio-inbound.mjs</code>).
            </>
          ) : (
            <>
              No se está guardando nada nuevo de Instagram. WhatsApp se guarda siempre, porque
              ahí no hay otro lugar de donde leer el hilo.
            </>
          )}
        </p>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
