"use client";

/**
 * Los diálogos de una fila de Generaciones: Anular (con el motivo obligatorio), completar lo que falta para reintentar
 * (F54) y el Detalle (valores usados, intentos, error y estado del email, con «Mandar el email ahora»).
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { DesignerDialog, inputClass, primaryButton, secondaryButton, textareaClass } from "@/components/designer/editor/overlays";
import { retryGeneration, sendGenerationEmail } from "@/lib/actions/designer/generate";
import { generationDetail } from "@/lib/actions/designer/generations";
import { voidDesign } from "@/lib/actions/designer/publish";
import type { GenerationDetail } from "@/lib/designer/generations-query";
import { MAX_VOID_REASON } from "@/lib/designer/publishing-limits";
import { voidReasonProblem } from "@/lib/designer/screens/publish-menu";
import { emailProblems } from "@/lib/designer/email-text";
import { initialEmail } from "@/lib/designer/screens/generate-one";
import { cn } from "@/lib/utils";
import { EmailFields } from "./email-fields";

/** Anular una pieza: el motivo es obligatorio y el link pasa a mostrar «anulado» (nunca se borra). */
export function VoidDialog({ designId, who, noun, onClose, onDone }: { designId: string; who: string; noun: string; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = voidReasonProblem(reason);

  async function submit() {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await voidDesign({ designId, reason: reason.trim() });
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      onDone(`Anulado: el link de ${who} muestra el motivo.`);
    } catch {
      setError("No se pudo anular. Revisá tu conexión y probá de nuevo.");
      setBusy(false);
    }
  }

  return (
    <DesignerDialog
      title={`Anular ${noun}`}
      label={`Anular ${noun} de ${who}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          {(error || (problem && reason)) && <p role={error ? "alert" : undefined} className={cn("mr-auto min-w-0 flex-1 text-xs", error ? "text-bad" : "text-muted-foreground")}>{error ?? problem}</p>}
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className={primaryButton} onClick={submit} disabled={!!problem || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Anular
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">La pieza de {who} queda anulada: el link sigue existiendo pero muestra «anulado» con el motivo, y no se puede descargar. No se borra.</p>
      <div className="space-y-1">
        <label htmlFor="void-reason" className="text-sm font-medium">
          Motivo de la anulación
        </label>
        <textarea id="void-reason" className={textareaClass} rows={3} maxLength={MAX_VOID_REASON} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por ejemplo: el nombre estaba mal escrito" />
      </div>
    </DesignerDialog>
  );
}

/**
 * Reintentar una pieza que falló por falta de un dato (F54): pide justo lo que falta. Si todavía falta algo después de
 * completar, el servidor lo devuelve y se sigue pidiendo; no cambia nada hasta que esté completo.
 */
export function RetryDataDialog({ designId, who, needs, onClose, onDone }: { designId: string; who: string; needs: { key: string; label: string }[]; onClose: () => void; onDone: (message: string) => void }) {
  const [asked, setAsked] = useState(needs);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = asked.every((n) => (values[n.key] ?? "").trim() !== "");

  async function submit() {
    if (!filled || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await retryGeneration({ designId, values });
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      if (res.data.needs && res.data.needs.length > 0) {
        // Todavía falta algo: se sigue pidiendo (y no se cambió nada).
        setAsked(res.data.needs);
        setBusy(false);
        return;
      }
      onDone(`Se vuelve a generar la pieza de ${who}.`);
    } catch {
      setError("No se pudo reintentar. Revisá tu conexión y probá de nuevo.");
      setBusy(false);
    }
  }

  return (
    <DesignerDialog
      title="Completá lo que falta"
      label={`Reintentar la pieza de ${who}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          {error && <p role="alert" className="mr-auto min-w-0 flex-1 text-xs text-bad">{error}</p>}
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className={primaryButton} onClick={submit} disabled={!filled || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Reintentar
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">La pieza de {who} no se generó porque faltaba un dato. Completalo y se vuelve a generar con lo mismo de siempre.</p>
      <ul className="space-y-3">
        {asked.map((n) => (
          <li key={n.key} className="space-y-1">
            <label htmlFor={`retry-${n.key}`} className="text-sm font-medium">
              {n.label}
              <span className="text-bad" aria-label="obligatorio"> *</span>
            </label>
            <input id={`retry-${n.key}`} className={inputClass} value={values[n.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [n.key]: e.target.value }))} />
          </li>
        ))}
      </ul>
    </DesignerDialog>
  );
}

/** El detalle de una pieza: los valores que se usaron, los intentos, el error y el estado del email. */
export function DetailDialog({ designId, who, onClose, onChanged }: { designId: string; who: string; onClose: () => void; onChanged: (message: string) => void }) {
  const [detail, setDetail] = useState<GenerationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mailOpen, setMailOpen] = useState(false);
  const [mail, setMail] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    generationDetail({ designId })
      .then((res) => {
        if (!alive) return;
        if (res.ok) setDetail(res.data);
        else setLoadError(res.error);
      })
      .catch(() => alive && setLoadError("No pudimos cargar el detalle. Probá de nuevo."));
    return () => {
      alive = false;
    };
  }, [designId]);

  const draft = mail ?? initialEmail(detail?.noun ?? null);
  const problem = mailOpen ? emailProblems(draft) : null;

  async function sendNow() {
    if (busy || problem) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sendGenerationEmail({ designId, subject: draft.subject.trim(), body: draft.body.trim() });
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      onChanged(`Se mandó el email a ${who}.`);
    } catch {
      setError("No se pudo mandar el email. Revisá tu conexión y probá de nuevo.");
      setBusy(false);
    }
  }

  return (
    <DesignerDialog title="Detalle de la pieza" label={`Detalle de la pieza de ${who}`} onClose={() => !busy && onClose()} footer={<button type="button" className={secondaryButton} onClick={onClose}>Cerrar</button>}>
      {loadError ? (
        <p role="alert" className="text-sm text-bad">{loadError}</p>
      ) : !detail ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Cargando…</p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Estado</dt>
            <dd>
              {detail.state.label}
              {detail.state.reason && <span className={cn("block text-xs", detail.state.key === "failed" ? "text-bad" : "text-muted-foreground")}>{detail.state.reason}</span>}
            </dd>
            <dt className="text-muted-foreground">Código</dt>
            <dd className="font-mono text-xs">{detail.code}</dd>
            <dt className="text-muted-foreground">Cómo se generó</dt>
            <dd>{detail.origin.text}</dd>
            <dt className="text-muted-foreground">Intentos</dt>
            <dd>{detail.attempts}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{detail.emailText}</dd>
            {detail.link && (
              <>
                <dt className="text-muted-foreground">Link</dt>
                <dd className="min-w-0 break-all">
                  <a href={detail.link} target="_blank" rel="noopener noreferrer" className="text-primary-ink underline-offset-2 hover:underline">
                    {detail.link}
                  </a>
                </dd>
              </>
            )}
          </dl>

          <section aria-labelledby="detail-values" className="space-y-1.5">
            <h3 id="detail-values" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Valores usados
            </h3>
            {detail.values.length === 0 ? (
              <p className="text-sm text-muted-foreground">Esta plantilla no usa variables.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {detail.values.map((v) => (
                  <li key={v.key} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5 text-sm">
                    <span className="text-muted-foreground">{v.label}</span>
                    <span className="min-w-0 break-words font-medium">{v.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {detail.canSendEmail && (
            <section className="space-y-2">
              {!mailOpen ? (
                <button type="button" className={secondaryButton} onClick={() => setMailOpen(true)}>
                  Mandar el email ahora
                </button>
              ) : (
                <>
                  <EmailFields subject={draft.subject} body={draft.body} onChange={setMail} />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={primaryButton} onClick={sendNow} disabled={busy || !!problem}>
                      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      Mandar el email
                    </button>
                    {(error || problem) && <p role={error ? "alert" : undefined} className={cn("text-xs", error ? "text-bad" : "text-muted-foreground")}>{error ?? problem}</p>}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </DesignerDialog>
  );
}
