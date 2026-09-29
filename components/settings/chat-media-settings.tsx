"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateChatMediaSettings } from "@/lib/actions/workspace";

/**
 * La media del chat: si se guarda y cuanto se conserva (F2, F5).
 *
 * Los dos controles van juntos porque son la misma decision vista de dos
 * maneras: cuanto espacio del bucket estamos dispuestos a usar. El texto tiene
 * que decir las dos cosas que no son obvias: que apagar el guardado deja los
 * mensajes nuevos sin archivo reproducible (porque el link del proveedor
 * vence), y que la retencion NO borra la transcripcion.
 */
const RETENTION_OPTIONS = [
  { value: 30, label: "30 días" },
  { value: 90, label: "90 días" },
  { value: 180, label: "180 días" },
  { value: 365, label: "1 año" },
  { value: 0, label: "No borrar nunca" },
];

export function ChatMediaSettings({
  enabled,
  retentionDays,
}: {
  enabled: boolean;
  retentionDays: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(next: { enabled?: boolean; retentionDays?: number }) {
    start(async () => {
      const result = await updateChatMediaSettings({
        enabled: next.enabled ?? enabled,
        retentionDays: next.retentionDays ?? retentionDays,
      });
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
        <Paperclip className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Fotos, videos y audios del chat</h2>
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
            onChange={(e) => save({ enabled: e.target.checked })}
            className="mt-0.5 h-4 w-4 flex-shrink-0 accent-current"
          />
          <span>
            <span className="block text-sm font-medium">
              Guardar una copia de lo que llega por el chat
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Cuando un lead manda una nota de voz, una foto o un documento, el archivo se copia a
              nuestro servidor. Es lo que permite escucharlo en la bandeja y transcribirlo para que
              el asistente lo entienda. Instagram y WhatsApp borran esos archivos de su lado a los
              pocos días, así que si no se copian, después no hay nada que escuchar.
            </span>
          </span>
        </label>

        {enabled && (
          <label
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-lg border border-border p-3",
              pending && "opacity-60",
            )}
          >
            <span className="text-sm font-medium">Conservar los archivos</span>
            <select
              value={retentionDays}
              disabled={pending}
              onChange={(e) => save({ retentionDays: Number(e.target.value) })}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            >
              {RETENTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {enabled ? (
            <>
              Pasado el plazo se borra el <strong>archivo</strong>, no el mensaje: la transcripción
              de un audio se conserva siempre, así que el asistente sigue sabiendo qué se dijo y en
              la conversación se sigue leyendo. Apagar el guardado no borra lo que ya está.
            </>
          ) : (
            <>
              No se está guardando nada nuevo. Los audios y las fotos que lleguen de ahora en más no
              se van a poder escuchar ni ver desde la bandeja, y el asistente va a derivar esas
              conversaciones a una persona porque no puede entenderlas.
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
