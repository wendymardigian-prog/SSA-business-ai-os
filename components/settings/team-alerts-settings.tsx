"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { saveTeamAlertsChannel } from "@/lib/actions/team-alerts";

/**
 * "Avisos al equipo por WhatsApp" (Ajustes → General): desde que WhatsApp del
 * negocio salen los avisos que cada persona eligio recibir por WhatsApp en
 * Mi cuenta → Notificaciones. Sin canal, nadie recibe avisos por WhatsApp.
 */
export function TeamAlertsSettings({
  channels,
  selectedId,
}: {
  /** Los WhatsApp conectados del negocio que pueden mandar. */
  channels: Array<{ id: string; name: string }>;
  selectedId: string | null;
}) {
  const [value, setValue] = useState(selectedId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  // Un canal elegido que se desconecto: se muestra para que se note, pero no se puede volver a elegir.
  const missing = Boolean(selectedId) && !channels.some((c) => c.id === selectedId);

  function change(next: string) {
    const previous = value;
    setValue(next);
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await saveTeamAlertsChannel({ channelId: next || null });
      if (!result.ok) {
        setError(result.error);
        setValue(previous);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  return (
    <section id="avisos-equipo" className="scroll-mt-20">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Avisos al equipo por WhatsApp</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Desde qué WhatsApp del negocio se le mandan a cada persona los avisos que eligió recibir por WhatsApp (en Mi cuenta →
        Notificaciones). Conviene un número que no use un lead para escribirte.
      </p>

      {channels.length === 0 && !missing ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No hay ningún WhatsApp conectado.{" "}
          <Link href="/dashboard/channels" className="text-primary underline underline-offset-2">
            Conectar uno en Canales
          </Link>
          .
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label htmlFor="team-alerts-channel" className="sr-only">
            WhatsApp para los avisos al equipo
          </label>
          <select
            id="team-alerts-channel"
            value={value}
            disabled={pending}
            onChange={(e) => change(e.target.value)}
            className="min-w-56 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          >
            <option value="">Nadie recibe avisos por WhatsApp</option>
            {missing && (
              <option value={selectedId!} disabled>
                Un WhatsApp que ya no está conectado
              </option>
            )}
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {saved && (
            <span role="status" className="text-xs text-emerald-600 dark:text-emerald-400">
              Guardado ✓
            </span>
          )}
          {error && (
            <span role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </span>
          )}
        </div>
      )}
      {missing && (
        <p role="alert" className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          El WhatsApp elegido se desconectó: mientras tanto no sale ningún aviso por WhatsApp. Reconectalo o elegí otro.
        </p>
      )}
    </section>
  );
}
