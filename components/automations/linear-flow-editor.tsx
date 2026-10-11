"use client";

/**
 * El editor lineal de un flujo (F57, extraído para Formularios en F21):
 * Cuándo / Si / Entonces.
 *
 * Es COMPARTIDO: la Agenda (`components/scheduling/event-editor/linear-flow-editor.tsx`)
 * y Formularios (`app/.../formularios/[id]/automatizaciones/[flowId]`) lo usan con sus
 * propias variables, su propia descripción del disparador y sus propias acciones.
 *
 * No es el canvas. Es la misma información leída como una lista, que es como
 * la gente piensa un recordatorio: "cuando pasa esto, si se cumple esto, hacé
 * estas cosas". El canvas sigue estando a un clic para lo que no entra acá.
 *
 * Si el flujo tiene ramas, esto es de solo lectura: guardar desde una vista
 * simplificada borraría la rama que no se ve.
 */

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Notice } from "@/components/agents/fields";
import { InsertAssetButton } from "@/components/response-assets/insert-asset-button";
import { PageHeader } from "@/components/page-header";
import { describeStep, type LinearFlow, type LinearStep } from "@/lib/scheduling/automation/linear-flow";

const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

export type EditorActionResult = { ok: true } | { ok: false; error: string };

export interface LinearFlowEditorProps {
  /** El link de "volver" del encabezado (ya armado por quien lo usa). */
  backHref: ReactNode;
  /** La ruta del encabezado (`PAGE_META`), para el título y el tooltip. */
  routeForHeader: string;
  flowId: string;
  flowName: string;
  /** null = el flujo tiene ramas y solo se puede abrir en el canvas. */
  linear: LinearFlow | null;
  enabled: boolean;
  /** A cuántas cosas alcanzaría hoy (reuniones), si el módulo lo calcula. */
  reach?: number | null;
  /** Texto de `reach`: "reunión" / "reuniones" ya conjugado es cosa de quien lo usa. */
  describeReach?: (reach: number) => string;
  /** Las variables que se pueden escribir entre llaves, sin las llaves (`booking.start_invitee`). */
  variableKeys: string[];
  /** Un ejemplo para la ayuda de variables. */
  variableExample: string;
  describeTrigger: (type: string, config: Record<string, unknown>) => string;
  onSave: (input: { flowId: string; linear: LinearFlow }) => Promise<EditorActionResult>;
  onSendTest: (input: { flowId: string; subject: string; body: string }) => Promise<EditorActionResult>;
}

export function LinearFlowEditor({
  backHref,
  routeForHeader,
  flowId,
  flowName,
  linear,
  enabled,
  reach = null,
  describeReach,
  variableKeys,
  variableExample,
  describeTrigger,
  onSave,
  onSendTest,
}: LinearFlowEditorProps) {
  const router = useRouter();
  const [steps, setSteps] = useState<LinearStep[]>(linear?.steps ?? []);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const readOnly = linear === null;
  const emailStep = steps.find((s) => s.kind === "email");

  function update(index: number, patch: Partial<LinearStep>) {
    setSteps((list) => list.map((s, i) => (i === index ? ({ ...s, ...patch } as LinearStep) : s)));
  }

  function save() {
    if (!linear) return;
    setNotice(null);
    start(async () => {
      const result = await onSave({ flowId, linear: { ...linear, steps } });
      setNotice(result.ok ? { kind: "ok", text: "Guardado" } : { kind: "error", text: result.error });
      if (result.ok) router.refresh();
    });
  }

  function sendTest() {
    if (!emailStep || emailStep.kind !== "email") return;
    setNotice(null);
    start(async () => {
      const result = await onSendTest({ flowId, subject: emailStep.subject, body: emailStep.body });
      setNotice(result.ok ? { kind: "ok", text: "Te mandé la prueba a tu email." } : { kind: "error", text: result.error });
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route={routeForHeader}
        title={flowName}
        backHref={backHref}
        left={
          <span
            className={
              enabled
                ? "rounded-full bg-green-500/12 px-2.5 py-0.5 text-xs text-green-600 dark:text-green-300"
                : "rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
            }
          >
            {enabled ? "Encendido" : "Apagado"}
          </span>
        }
        right={
          <Link href={`/dashboard/flows/${flowId}`} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Abrir en el canvas
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
      {notice && <Notice tone={notice.kind === "ok" ? "success" : "error"}>{notice.text}</Notice>}

      {readOnly && (
        <Notice tone="info">
          Este flujo tiene ramas (una condición que sigue por dos caminos), así que no se puede editar como lista. Abrilo en el canvas.
        </Notice>
      )}

      <section className="rounded-xl border border-border p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cuándo</h2>
        <p className="mt-1 text-sm">
          {linear ? describeTrigger(linear.trigger.type, linear.trigger.config) : "—"}
        </p>
        {reach !== null && describeReach && <p className="mt-1 text-xs text-muted-foreground">{describeReach(reach)}</p>}
      </section>

      {linear && linear.conditions.length > 0 && (
        <section className="rounded-xl border border-border p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Si</h2>
          <ul className="mt-1 list-inside list-disc text-sm">
            {linear.conditions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Entonces</h2>

        {steps.length === 0 && <p className="text-sm text-muted-foreground">Este flujo no hace nada todavía.</p>}

        {steps.map((step, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">
              {i + 1}. {describeStep(step)}
            </p>
            {step.kind === "email" && step.to === "fixed" && step.fixedEmail && <p className="text-xs text-muted-foreground">Para: {step.fixedEmail}</p>}

            {step.kind === "email" && (
              <>
                <div className="space-y-1">
                  <label htmlFor={`s-${i}-subject`} className="text-xs text-muted-foreground">
                    Asunto
                  </label>
                  <input
                    id={`s-${i}-subject`}
                    value={step.subject}
                    disabled={readOnly}
                    onChange={(e) => update(i, { subject: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor={`s-${i}-body`} className="text-xs text-muted-foreground">
                      Texto
                    </label>
                    <InsertAssetButton
                      targetId={`s-${i}-body`}
                      value={step.body}
                      disabled={readOnly}
                      onChange={(body) => update(i, { body })}
                    />
                  </div>
                  <textarea
                    id={`s-${i}-body`}
                    value={step.body}
                    disabled={readOnly}
                    rows={10}
                    onChange={(e) => update(i, { body: e.target.value })}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
                  />
                </div>
              </>
            )}

            {step.kind === "whatsapp" && (
              <div className="space-y-1">
                <div className="flex justify-end">
                  <InsertAssetButton
                    targetId={`s-${i}-text`}
                    value={step.text}
                    disabled={readOnly}
                    onChange={(text) => update(i, { text })}
                  />
                </div>
                <textarea
                  id={`s-${i}-text`}
                  aria-label="Mensaje de WhatsApp"
                  value={step.text}
                  disabled={readOnly}
                  rows={5}
                  onChange={(e) => update(i, { text: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            )}

            {step.kind === "delay" && (
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  aria-label="Cuánto esperar"
                  value={step.duration}
                  disabled={readOnly}
                  onChange={(e) => update(i, { duration: Number(e.target.value) || 1 })}
                  className="h-9 w-24 rounded-lg border border-input bg-background px-2 text-sm"
                />
                <select
                  aria-label="Unidad"
                  value={step.unit}
                  disabled={readOnly}
                  onChange={(e) => update(i, { unit: e.target.value })}
                  className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                >
                  <option value="minutes">minutos</option>
                  <option value="hours">horas</option>
                  <option value="days">días</option>
                </select>
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-border p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Variables</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Se reemplazan al enviar. Escribilas entre llaves dobles, por ejemplo <code>{`{{${variableExample}}}`}</code>.
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {variableKeys.map((key) => (
            <li key={key}>
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{`{{${key}}}`}</code>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap gap-2">
        {!readOnly && (
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Guardando…" : "Guardar"}
          </button>
        )}
        {emailStep && (
          <button
            type="button"
            onClick={sendTest}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden /> Enviarme una prueba
          </button>
        )}
      </div>
        <p className="text-xs text-muted-foreground">
          La prueba va solo a tu email, con datos de ejemplo. No le llega a ningún contacto ni cuenta en su historial.
        </p>
      </div>
    </div>
  );
}
