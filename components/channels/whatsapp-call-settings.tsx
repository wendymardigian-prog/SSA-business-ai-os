"use client";

import { useState, useTransition } from "react";
import { Loader2, Phone } from "lucide-react";
import { getWhatsappCallSettings, saveWhatsappCallSettings } from "@/lib/actions/whatsapp-calls";
import { DEFAULT_CALL_MESSAGE, MAX_CALL_MESSAGE } from "@/lib/whatsapp-calls/settings";

/**
 * Las llamadas de un número de WhatsApp (00258), en su tarjeta de canal.
 *
 * Evolution no puede atender llamadas: lo que se puede es rechazarlas solas y
 * contestar con un mensaje. Cada llamada (atendida o no) queda igual en el
 * chat. Se carga al abrir: leer los ajustes es una llamada a Evolution.
 */
export function WhatsappCallSettings({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [rejectCall, setRejectCall] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      start(async () => {
        const result = await getWhatsappCallSettings(channelId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setRejectCall(result.rejectCall);
        setMessage(result.msgCall || DEFAULT_CALL_MESSAGE);
        setLoaded(true);
      });
    }
  }

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await saveWhatsappCallSettings(channelId, { rejectCall, msgCall: message });
      if (!result.ok) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium hover:bg-muted"
      >
        <Phone className="h-3 w-3" aria-hidden />
        Llamadas
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-2.5 py-2 text-[11px]">
          <p className="text-muted-foreground">
            Desde acá no se pueden atender llamadas (Evolution no lo permite). Cada llamada queda en el chat y, si nadie atiende, avisa al
            responsable.
          </p>
          {!loaded && pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Cargando" />
          ) : loaded ? (
            <>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={rejectCall} onChange={(e) => setRejectCall(e.target.checked)} />
                Rechazar las llamadas automáticamente
              </label>
              {rejectCall && (
                <label className="block space-y-1">
                  <span className="text-muted-foreground">Mensaje que se manda al rechazar</span>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={MAX_CALL_MESSAGE}
                    rows={2}
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                  />
                </label>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground disabled:opacity-50"
                >
                  {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                  Guardar
                </button>
                {saved && <span className="text-muted-foreground">Guardado.</span>}
              </div>
            </>
          ) : null}
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-2 py-1 text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
