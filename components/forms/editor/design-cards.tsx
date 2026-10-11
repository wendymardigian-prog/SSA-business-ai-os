"use client";

import { Field, inputClass, Checkbox } from "@/components/agents/fields";
import type { SuccessConfig } from "@/lib/forms/success";
import type { Draft } from "./types";

/** Diseño y pantalla de éxito (F7): dos tarjetas plegables al pie de Campos. */
export function DesignCards({ draft, onChange, disabled }: { draft: Draft; onChange: (next: Draft) => void; disabled: boolean }) {
  const { design, success } = draft;
  const redirect = success.mode === "redirect";

  function setSuccess(next: SuccessConfig) {
    onChange({ ...draft, success: next });
  }

  return (
    <div className="space-y-3">
      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Diseño</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Título">
            {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={200} value={design.title} onChange={(e) => onChange({ ...draft, design: { ...design, title: e.target.value } })} />}
          </Field>
          <Field label="Texto del botón" hint="Vacío: “Enviar” (“Firmar y enviar” en un contrato).">
            {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={60} value={design.submitLabel} onChange={(e) => onChange({ ...draft, design: { ...design, submitLabel: e.target.value } })} />}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Introducción" hint="Aparece debajo del título. Los saltos de línea se respetan.">
              {(id) => <textarea id={id} rows={3} className={inputClass} disabled={disabled} maxLength={2000} value={design.intro} onChange={(e) => onChange({ ...draft, design: { ...design, intro: e.target.value } })} />}
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Checkbox checked={design.showLogo} onChange={(showLogo) => onChange({ ...draft, design: { ...design, showLogo } })} label="Mostrar el logo" description="El logo y el color salen de la marca de esta copia del sistema." />
          </div>
        </div>
      </details>

      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Cuando envían el formulario</summary>
        <div className="mt-4 space-y-4">
          <fieldset className="flex gap-4 text-sm">
            <legend className="sr-only">Qué pasa al enviar</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="success-mode" disabled={disabled} checked={!redirect} onChange={() => setSuccess({ mode: "message", title: "¡Gracias!", body: "Recibimos tu respuesta." })} />
              Mostrar un mensaje
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="success-mode" disabled={disabled} checked={redirect} onChange={() => setSuccess({ mode: "redirect", url: "https://", passParams: false })} />
              Llevar a otra página
            </label>
          </fieldset>

          {success.mode === "message" ? (
            <div className="grid gap-4">
              <Field label="Título" hint="Podés usar {{answer.clave}} y {{form.name}}.">
                {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={200} value={success.title ?? ""} onChange={(e) => setSuccess({ ...success, title: e.target.value })} />}
              </Field>
              <Field label="Mensaje">
                {(id) => <textarea id={id} rows={3} className={inputClass} disabled={disabled} maxLength={2000} value={success.body ?? ""} onChange={(e) => setSuccess({ ...success, body: e.target.value })} />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Botón: texto (opcional)">
                  {(id) => (
                    <input
                      id={id}
                      className={inputClass}
                      disabled={disabled}
                      maxLength={60}
                      value={success.button?.label ?? ""}
                      onChange={(e) => setSuccess({ ...success, button: e.target.value ? { label: e.target.value, url: success.button?.url ?? "https://" } : undefined })}
                    />
                  )}
                </Field>
                <Field label="Botón: dirección">
                  {(id) => (
                    <input
                      id={id}
                      className={inputClass}
                      disabled={disabled || !success.button}
                      value={success.button?.url ?? ""}
                      placeholder="https://"
                      onChange={(e) => success.button && setSuccess({ ...success, button: { ...success.button, url: e.target.value } })}
                    />
                  )}
                </Field>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <Field label="Dirección" hint="Tiene que empezar con http:// o https://.">
                {(id) => <input id={id} className={inputClass} disabled={disabled} value={success.url} onChange={(e) => setSuccess({ ...success, url: e.target.value })} />}
              </Field>
              <Checkbox
                checked={success.passParams}
                onChange={(passParams) => setSuccess({ ...success, passParams })}
                label="Sumar a la dirección el id de la respuesta y los UTM"
                description="Nunca se suman las respuestas de la persona."
              />
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
