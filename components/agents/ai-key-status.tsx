import Link from "next/link";
import { AI_KEY_STATE_LABELS, type AiKeyProviderState, type AiKeyState } from "@/lib/ai/provider-states";
import { cn } from "@/lib/utils";

/**
 * Las claves de IA del negocio en Agentes IA: una fila por proveedor con su estado (conectada, sin
 * conectar o con error) y, para quien tiene `integrations.manage`, el acceso a Integraciones para conectarla o
 * sustituirla. Nunca muestra la clave: el estado sale de `integration_configs` (la clave vive en Vault).
 */

const DOT: Record<AiKeyState, string> = {
  connected: "bg-emerald-500",
  not_connected: "bg-muted-foreground/40",
  error: "bg-red-500",
};

const TEXT: Record<AiKeyState, string> = {
  connected: "text-emerald-700 dark:text-emerald-400",
  not_connected: "text-muted-foreground",
  error: "text-red-700 dark:text-red-400",
};

const ACTION: Record<AiKeyState, string | null> = {
  connected: null,
  not_connected: "Conectar",
  error: "Reemplazar la clave",
};

export function AiKeyStatus({ providers, canConnect }: { providers: AiKeyProviderState[]; canConnect: boolean }) {
  return (
    <section aria-labelledby="ai-keys-title" className="mb-8">
      <h2 id="ai-keys-title" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Claves de IA
      </h2>
      <ul className="grid gap-2 sm:grid-cols-3" data-testid="ai-key-status">
        {providers.map((p) => {
          const action = ACTION[p.state];
          return (
            <li
              key={p.id}
              data-provider={p.id}
              data-state={p.state}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{p.label}</p>
                <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TEXT[p.state])}>
                  <span className={cn("h-2 w-2 rounded-full", DOT[p.state])} aria-hidden />
                  {AI_KEY_STATE_LABELS[p.state]}
                </span>
              </div>
              {p.reason && <p className="text-xs text-muted-foreground">{p.reason}</p>}
              {action && canConnect && (
                <Link
                  href={`/dashboard/settings/integrations/${p.id}`}
                  className="text-xs font-medium text-primary-ink underline-offset-2 hover:underline"
                >
                  {action}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {!canConnect && providers.some((p) => p.state !== "connected") && (
        <p className="mt-2 text-xs text-muted-foreground">
          Las claves las conecta quien administra el negocio, desde Ajustes › Integraciones.
        </p>
      )}
    </section>
  );
}
