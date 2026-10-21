"use client";

import { Checkbox, Field, inputClass } from "@/components/agents/fields";
import type { FormField } from "@/lib/forms/fields";
import type { SuccessConfig } from "@/lib/forms/success";

/**
 * El panel de "Después de enviar" (plano formularios-ui, F11): un mensaje o llevar a otra página. Las mismas reglas
 * y los mismos campos de siempre (antes vivian en una tarjeta plegable al pie de Campos).
 */
export function InspectorEnd({
  success,
  onChange,
  fields,
  disabled,
  isContract = false,
}: {
  success: SuccessConfig;
  onChange: (next: SuccessConfig) => void;
  fields: FormField[];
  disabled: boolean;
  /** Un contrato suma el botón "Descargar contrato" (solo con mensaje). */
  isContract?: boolean;
}) {
  const redirect = success.mode === "redirect";
  const keys = fields.filter((f) => f.type !== "hidden").map((f) => f.key);
  return (
    <div className="space-y-4">
      <fieldset className="space-y-1.5 text-sm">
        <legend className="mb-1 text-xs font-semibold">Qué pasa al enviar</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="success-mode"
            disabled={disabled}
            checked={!redirect}
            onChange={() => onChange({ mode: "message", title: "¡Gracias!", body: "Recibimos tu respuesta.", ...(isContract ? { downloadContract: true } : {}) })}
          />
          Mostrar un mensaje
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="success-mode" disabled={disabled} checked={redirect} onChange={() => onChange({ mode: "redirect", url: "https://", passParams: false })} />
          Llevar a otra página
        </label>
      </fieldset>

      {success.mode === "message" ? (
        <>
          {isContract && (
            <Checkbox
              checked={success.downloadContract === true}
              onChange={(downloadContract) => onChange({ ...success, downloadContract })}
              label="Mostrar el botón «Descargar contrato»"
              description="Quien firma baja su copia en PDF en el momento. El link sirve 24 horas y solo para esa persona; la copia también le llega por correo."
            />
          )}
          <Field label="Título" hint="Podés usar {{answer.clave}} y {{form.name}}.">
            {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={200} value={success.title ?? ""} onChange={(e) => onChange({ ...success, title: e.target.value })} />}
          </Field>
          <Field label="Mensaje">
            {(id) => <textarea id={id} rows={4} className={inputClass} disabled={disabled} maxLength={2000} value={success.body ?? ""} onChange={(e) => onChange({ ...success, body: e.target.value })} />}
          </Field>
          <Field label="Botón: texto (opcional)">
            {(id) => (
              <input
                id={id}
                className={inputClass}
                disabled={disabled}
                maxLength={60}
                value={success.button?.label ?? ""}
                onChange={(e) => onChange({ ...success, button: e.target.value ? { label: e.target.value, url: success.button?.url ?? "https://" } : undefined })}
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
                onChange={(e) => success.button && onChange({ ...success, button: { ...success.button, url: e.target.value } })}
              />
            )}
          </Field>
          {keys.length > 0 && (
            <div>
              <p className="text-xs font-semibold">Variables que podés usar</p>
              <ul className="mt-1.5 flex flex-wrap gap-1">
                <li className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px]">{"{{form.name}}"}</li>
                {keys.slice(0, 12).map((key) => (
                  <li key={key} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px]">{`{{answer.${key}}}`}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <>
          <Field label="Dirección" hint="Tiene que empezar con http:// o https://.">
            {(id) => <input id={id} className={inputClass} disabled={disabled} value={success.url} onChange={(e) => onChange({ ...success, url: e.target.value })} />}
          </Field>
          <Checkbox
            checked={success.passParams}
            onChange={(passParams) => onChange({ ...success, passParams })}
            label="Sumar a la dirección el id de la respuesta y los UTM"
            description="Nunca se suman las respuestas de la persona."
          />
        </>
      )}
    </div>
  );
}
