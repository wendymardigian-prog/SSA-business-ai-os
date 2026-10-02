"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserRoundCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateAgentEscalation } from "@/lib/actions/workspace";

/**
 * Si el agente escala a una persona cuando no puede interpretar un mensaje
 * de la ráfaga (00103, S2). Hasta este bloque la columna
 * `agent_escalate_on_unreadable` no tenía ninguna interfaz: se editaba a
 * mano en la base.
 *
 * Prendido (el default) es el comportamiento correcto; se puede apagar si
 * genera demasiado escalado. Mismo patrón que
 * components/settings/message-persistence-settings.tsx.
 */
export function EscalationSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(value: boolean) {
    start(async () => {
      const result = await updateAgentEscalation(value);
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
        <UserRoundCog className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Escalado por mensaje sin entender</h3>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="mt-4">
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
              Escalar a una persona cuando no se entiende un audio o imagen
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Si el agente no puede interpretar un mensaje de la ráfaga (por ejemplo, una
              nota de voz que todavía no se transcribió), avisa y se apaga para esa
              conversación en vez de contestar a ciegas. Apagar esto hace que el agente
              siga de largo con lo que sí pudo interpretar.
            </span>
          </span>
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
