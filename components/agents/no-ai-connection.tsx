import Link from "next/link";
import { KeyRound, Plug } from "lucide-react";
import { getProvider } from "@/lib/integrations/providers";

/**
 * Lo que se ve en Agentes IA cuando no hay NINGUNA IA conectada (E1): los
 * agentes no pueden responder hasta que haya una, asi que en vez de una lista
 * de agentes "encendidos" que no funcionan, se explica que falta y se ofrecen
 * las tres opciones con un acceso directo a cada una (sin buscar a mano la
 * pagina correcta en Integraciones).
 *
 * Las claves son del propio negocio (BYOK): el consumo se factura a su cuenta.
 */

const OPTIONS = ["anthropic", "openai", "google_ai"] as const;

export function NoAiConnection({ canConnect }: { canConnect: boolean }) {
  return (
    <section aria-labelledby="no-ai-title" className="mb-6 rounded-xl border border-amber-300/60 bg-amber-50/50 p-4 dark:border-amber-800/50 dark:bg-amber-950/10 md:p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          <KeyRound className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 id="no-ai-title" className="text-sm font-semibold">
            Para usar los agentes falta conectar una IA
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Los agentes necesitan el modelo de una IA para responder. Todavía no hay ninguna conectada, así que no se pueden encender. Conectá una con tu propia cuenta (el consumo se factura a tu cuenta) y ya podés usarlos.
          </p>
        </div>
      </div>

      {canConnect ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {OPTIONS.map((id) => {
            const provider = getProvider(id);
            if (!provider) return null;
            return (
              <li key={id} className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-card p-3">
                <div>
                  <p className="text-sm font-medium">{provider.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{provider.description}</p>
                </div>
                <Link
                  href={`/dashboard/settings/integrations/${id}`}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  <Plug className="h-3.5 w-3.5" aria-hidden />
                  Conectar {provider.label.split(" ")[0]}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Pedile a quien administra el negocio que la conecte desde Ajustes → Integraciones.</p>
      )}
    </section>
  );
}
