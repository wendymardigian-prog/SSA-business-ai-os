"use client";

import { useEffect, useState } from "react";
import { generateAutomationWebhookSecret, getAutomationWebhookSecretInfo, saveAutomationWebhookSecret } from "@/lib/actions/automation-webhook-secret";
import { WEBHOOK_ID_HEADER, WEBHOOK_SECRET_MIN_LENGTH, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER, webhookSecretProblem } from "@/lib/automations/webhook-signature-constants";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const buttonClass = "h-8 rounded-lg border border-border px-2.5 text-xs text-foreground hover:bg-accent disabled:opacity-50";

/**
 * «Firmar la llamada» de la Llamada HTTP: prende la firma del paso y maneja la clave del negocio (una sola para todas
 * las automatizaciones). La clave se genera acá (se ve UNA vez, para copiarla) o se pega la que pasó quien recibe; la
 * pantalla después solo sabe si está guardada.
 */
export function WebhookSignPanel({ sign, onToggle }: { sign: boolean; onToggle: (sign: boolean) => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");

  useEffect(() => {
    if (!sign) return;
    let alive = true;
    getAutomationWebhookSecretInfo()
      .then((r) => {
        if (!alive) return;
        if (r.ok) setConfigured(r.configured);
        else setError(r.error);
      })
      .catch(() => alive && setError("No se pudo comprobar la clave."));
    return () => {
      alive = false;
    };
  }, [sign]);

  const generate = async () => {
    if (configured && !window.confirm("Ya hay una clave. Si generás otra, quien recibe tiene que cambiarla también o va a rechazar las llamadas. ¿Seguimos?")) return;
    setBusy(true);
    setError(null);
    const r = await generateAutomationWebhookSecret();
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setConfigured(true);
    setShown(r.secret ?? null);
    setPasting(false);
  };

  const savePasted = async () => {
    const problem = webhookSecretProblem(pasted);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const r = await saveAutomationWebhookSecret({ secret: pasted });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setConfigured(true);
    setPasted("");
    setPasting(false);
    setShown(null);
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <label className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <input type="checkbox" checked={sign} onChange={(e) => onToggle(e.target.checked)} />
        Firmar la llamada
      </label>
      <p className="text-xs text-muted-foreground">
        Suma los encabezados {WEBHOOK_ID_HEADER}, {WEBHOOK_TIMESTAMP_HEADER} y {WEBHOOK_SIGNATURE_HEADER} (HMAC-SHA256 de «id.hora.cuerpo» con la clave del negocio), para que quien recibe compruebe que la mandaste vos.
      </p>
      {sign && (
        <div className="space-y-2">
          <p className="text-xs text-foreground" role="status">
            {configured === null && !error ? "Comprobando la clave…" : configured ? "La clave del negocio está guardada (es la misma para todas las automatizaciones)." : "Todavía no hay clave: sin clave el paso no manda nada."}
          </p>
          {shown && (
            <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950/40">
              <p className="text-[11px] text-amber-900 dark:text-amber-200">Copiala ahora y pasásela a quien recibe: no se vuelve a mostrar.</p>
              <div className="flex gap-1">
                <input readOnly value={shown} onFocus={(e) => e.target.select()} className={`${inputClass} font-mono text-xs`} aria-label="Clave generada" />
                <button type="button" className={buttonClass} onClick={() => void navigator.clipboard?.writeText(shown)}>
                  Copiar
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void generate()}>
              {configured ? "Generar otra clave" : "Generar una clave"}
            </button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => setPasting((v) => !v)}>
              Pegar una clave
            </button>
          </div>
          {pasting && (
            <div className="flex gap-1">
              <input
                type="password"
                autoComplete="off"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={`Al menos ${WEBHOOK_SECRET_MIN_LENGTH} caracteres`}
                className={inputClass}
                aria-label="Clave para firmar"
              />
              <button type="button" className={buttonClass} disabled={busy || !pasted.trim()} onClick={() => void savePasted()}>
                Guardar
              </button>
            </div>
          )}
          {error && <p className="text-[11px] text-warn">{error}</p>}
        </div>
      )}
    </div>
  );
}
