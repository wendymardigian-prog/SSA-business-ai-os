"use client";

import { useState } from "react";
import { Field, Checkbox, inputClass } from "@/components/agents/fields";
import { ALLOWED_UPLOAD_MIMES, FIELD_TYPE_LABELS, FILE_LIMITS, MAX_PREFILL_PARAMS, PREFILL_PARAM_RE, socialDefaultLabel, supportsPrefill, type FormField, type PrefillBehavior } from "@/lib/forms/fields";
import { SOCIAL_LABELS, SOCIAL_PLATFORMS, isSocialPlatform } from "@/lib/contacts/social";
import { ATTRIBUTION_KEYS } from "@/lib/attribution/keys";
import { conditionSources } from "@/lib/forms/builder";
import { describeAccepted } from "@/components/forms/public/fields/file-field";
import { VisibilityRuleBuilder } from "./visibility-rule-builder";

/**
 * El panel de un campo (F4): etiqueta, ayuda, obligatorio, opciones, rangos,
 * archivo, consentimiento, oculto, "llenar desde la URL" y condiciones.
 *
 * Aspecto de `QuestionFieldModal.tsx` de prevxcrm, sin el selector de servicio ni
 * el modo de persistencia: el mapeo a contacto vive en la pestaña Contacto.
 */

const BEHAVIOR_LABELS: Record<PrefillBehavior, string> = {
  editable: "Editable (aparece lleno y se puede cambiar)",
  locked: "Bloqueado (aparece lleno y no se puede cambiar)",
  hidden: "Ocultar si viene lleno (se envía igual)",
};

const SAMPLE_MIMES = ALLOWED_UPLOAD_MIMES;

export function FieldEditor({
  field,
  index,
  fields,
  neverPublished,
  disabled,
  onPatch,
  onRelabel,
  onSetKey,
}: {
  field: FormField;
  index: number;
  fields: FormField[];
  neverPublished: boolean;
  disabled: boolean;
  onPatch: (patch: Partial<FormField>) => void;
  onRelabel: (label: string) => void;
  onSetKey: (key: string) => string | undefined;
}) {
  const [keyError, setKeyError] = useState<string | undefined>();
  const [paramDraft, setParamDraft] = useState("");
  const [paramError, setParamError] = useState<string | undefined>();
  const isHidden = field.type === "hidden";
  const hasOptions = field.type === "single_select" || field.type === "multi_select";
  const textLike = field.type === "short_text" || field.type === "long_text" || field.type === "email" || field.type === "phone" || field.type === "number" || field.type === "social";
  const prefillOk = supportsPrefill(field.type) && !isHidden;
  const prefill = field.prefill ?? { params: [field.key], behavior: "editable" as PrefillBehavior };
  const usedParams = new Set(fields.filter((f) => f.key !== field.key).flatMap((f) => (f.prefill?.params ?? [f.key]).map((p) => p.toLowerCase())));

  function addParam() {
    const value = paramDraft.trim();
    if (!value) return;
    if (!PREFILL_PARAM_RE.test(value)) return setParamError("Usá letras, números, punto, guión o guión bajo (hasta 40)");
    if (usedParams.has(value.toLowerCase())) return setParamError("Otro campo ya usa ese parámetro");
    if (prefill.params.some((p) => p.toLowerCase() === value.toLowerCase())) return setParamError("Ya está en la lista");
    if (prefill.params.length >= MAX_PREFILL_PARAMS) return setParamError(`Como máximo ${MAX_PREFILL_PARAMS} parámetros`);
    setParamError(undefined);
    setParamDraft("");
    onPatch({ prefill: { ...prefill, params: [...prefill.params, value] } });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{FIELD_TYPE_LABELS[field.type]}</p>

      <Field label="Etiqueta">
        {(id) => <input id={id} className={inputClass} value={field.label} disabled={disabled} maxLength={200} onChange={(e) => onRelabel(e.target.value)} />}
      </Field>

      {!isHidden && (
        <>
          <Field label="Ayuda (opcional)" hint="Aparece debajo del campo.">
            {(id) => <input id={id} className={inputClass} value={field.help ?? ""} disabled={disabled} maxLength={500} onChange={(e) => onPatch({ help: e.target.value || undefined })} />}
          </Field>
          {(textLike || field.type === "date") && field.type !== "date" && (
            <Field label="Texto de ejemplo (opcional)">
              {(id) => <input id={id} className={inputClass} value={field.placeholder ?? ""} disabled={disabled} maxLength={200} onChange={(e) => onPatch({ placeholder: e.target.value || undefined })} />}
            </Field>
          )}
          <Checkbox checked={field.required} onChange={(required) => onPatch({ required })} label="Obligatorio" description={field.type === "consent" ? "Tiene que tildarlo para enviar." : undefined} />
        </>
      )}

      {hasOptions && (
        <Field label="Opciones" hint="Una por línea. De 2 a 50, sin repetir.">
          {(id) => (
            <textarea
              id={id}
              rows={5}
              className={inputClass}
              disabled={disabled}
              value={(field.options ?? []).join("\n")}
              onChange={(e) => onPatch({ options: e.target.value.split("\n") })}
            />
          )}
        </Field>
      )}

      {field.type === "social" && field.social && (
        <Field label="Red social" hint="A qué red pertenece el usuario. Se guarda en el contacto en el dato de esa red.">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              disabled={disabled}
              value={field.social!.platform}
              onChange={(e) => {
                if (!isSocialPlatform(e.target.value)) return;
                const platform = e.target.value;
                // Si la etiqueta todavía es la automática de la red anterior, acompaña a la nueva.
                const followsDefault = field.label === socialDefaultLabel(field.social!.platform);
                onPatch({ social: { platform }, ...(followsDefault ? { label: socialDefaultLabel(platform) } : {}) });
              }}
            >
              {SOCIAL_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {SOCIAL_LABELS[p]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {field.type === "number" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mínimo">
            {(id) => <input id={id} type="number" className={inputClass} disabled={disabled} value={field.min ?? ""} onChange={(e) => onPatch({ min: e.target.value === "" ? undefined : Number(e.target.value) })} />}
          </Field>
          <Field label="Máximo">
            {(id) => <input id={id} type="number" className={inputClass} disabled={disabled} value={field.max ?? ""} onChange={(e) => onPatch({ max: e.target.value === "" ? undefined : Number(e.target.value) })} />}
          </Field>
        </div>
      )}

      {field.type === "file" && field.file && (
        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold">Archivo</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tamaño máximo (MB)">
              {(id) => (
                <input id={id} type="number" min={1} max={FILE_LIMITS.maxMb} className={inputClass} disabled={disabled} value={field.file!.maxMb} onChange={(e) => onPatch({ file: { ...field.file!, maxMb: Number(e.target.value) } })} />
              )}
            </Field>
            <Field label="Cantidad máxima">
              {(id) => (
                <input id={id} type="number" min={1} max={FILE_LIMITS.maxFiles} className={inputClass} disabled={disabled} value={field.file!.maxFiles} onChange={(e) => onPatch({ file: { ...field.file!, maxFiles: Number(e.target.value) } })} />
              )}
            </Field>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold">Tipos permitidos</p>
            {SAMPLE_MIMES.map((mime) => (
              <Checkbox
                key={mime}
                checked={field.file!.accept.includes(mime)}
                onChange={(on) => onPatch({ file: { ...field.file!, accept: on ? [...field.file!.accept, mime] : field.file!.accept.filter((m) => m !== mime) } })}
                label={describeAccepted([mime])}
              />
            ))}
          </div>
        </fieldset>
      )}

      {field.type === "consent" && (
        <Field label="Texto del consentimiento">
          {(id) => <textarea id={id} rows={2} className={inputClass} disabled={disabled} value={field.consentText ?? ""} maxLength={500} onChange={(e) => onPatch({ consentText: e.target.value })} />}
        </Field>
      )}

      {isHidden && field.hidden && (
        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold">De dónde sale el valor</legend>
          <Field label="Fuente">
            {(id) => (
              <select
                id={id}
                className={inputClass}
                disabled={disabled}
                value={field.hidden!.source}
                onChange={(e) => {
                  const source = e.target.value as "url_param" | "fixed" | "attribution";
                  onPatch({ hidden: source === "fixed" ? { source, value: "" } : { source, param: source === "attribution" ? "utm_campaign" : field.key } });
                }}
              >
                <option value="url_param">Un parámetro de la URL</option>
                <option value="attribution">Un dato de atribución de la visita</option>
                <option value="fixed">Un valor fijo</option>
              </select>
            )}
          </Field>
          {field.hidden.source === "url_param" && (
            <Field label="Parámetro" hint="Por ejemplo utm_campaign. Se toma de la página donde está el formulario.">
              {(id) => <input id={id} className={inputClass} disabled={disabled} value={field.hidden!.param ?? ""} onChange={(e) => onPatch({ hidden: { source: "url_param", param: e.target.value.trim() } })} />}
            </Field>
          )}
          {field.hidden.source === "attribution" && (
            <Field label="Dato" hint="Toma el de la visita aunque la persona haya navegado a otra página antes de llegar.">
              {(id) => (
                <select id={id} className={inputClass} disabled={disabled} value={field.hidden!.param ?? "utm_campaign"} onChange={(e) => onPatch({ hidden: { source: "attribution", param: e.target.value } })}>
                  {ATTRIBUTION_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {field.hidden.source === "fixed" && (
            <Field label="Valor" hint="Lo pone el servidor al guardar. Nunca viaja al navegador de quien responde.">
              {(id) => <input id={id} className={inputClass} disabled={disabled} value={field.hidden!.value ?? ""} maxLength={500} onChange={(e) => onPatch({ hidden: { source: "fixed", value: e.target.value } })} />}
            </Field>
          )}
        </fieldset>
      )}

      {prefillOk && (
        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold">Llenar desde la URL</legend>
          <div>
            <p className="text-xs font-semibold">Parámetros</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Parámetros que llenan este campo">
              {prefill.params.map((param) => (
                <li key={param} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs">
                  {param}
                  {!disabled && prefill.params.length > 1 && (
                    <button type="button" aria-label={`Quitar ${param}`} onClick={() => onPatch({ prefill: { ...prefill, params: prefill.params.filter((p) => p !== param) } })} className="text-muted-foreground hover:text-foreground">
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!disabled && (
              <div className="mt-2 flex gap-2">
                <input
                  aria-label="Nuevo parámetro"
                  className={inputClass}
                  placeholder="correo"
                  value={paramDraft}
                  onChange={(e) => setParamDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addParam();
                    }
                  }}
                />
                <button type="button" onClick={addParam} className="shrink-0 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                  Agregar
                </button>
              </div>
            )}
            {paramError && <p className="mt-1 text-xs text-destructive">{paramError}</p>}
            <p className="mt-1 text-[11px] text-muted-foreground">Se usa el primero que venga con valor. Por defecto, la clave del campo.</p>
          </div>
          <Field label="Comportamiento">
            {(id) => (
              <select id={id} className={inputClass} disabled={disabled} value={prefill.behavior} onChange={(e) => onPatch({ prefill: { ...prefill, behavior: e.target.value as PrefillBehavior } })}>
                {(Object.keys(BEHAVIOR_LABELS) as PrefillBehavior[]).map((b) => (
                  <option key={b} value={b}>
                    {BEHAVIOR_LABELS[b]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </fieldset>
      )}

      <fieldset className="space-y-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-xs font-semibold">Mostrar solo si…</legend>
        <VisibilityRuleBuilder value={field.visibility} onChange={(visibility) => onPatch({ visibility })} sources={conditionSources(fields, index)} />
      </fieldset>

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-xs font-semibold">Avanzado</summary>
        <div className="mt-3">
          <Field
            label="Clave"
            hint={
              neverPublished
                ? "Identifica este campo en las respuestas y en las automatizaciones ({{answer.clave}}). Podés cambiarla mientras el formulario no se publicó."
                : "Identifica este campo en las respuestas y en las automatizaciones ({{answer.clave}}). Ya se publicó: no se puede cambiar."
            }
          >
            {(id) => (
              <input
                id={id}
                className={inputClass}
                disabled={disabled || !neverPublished}
                defaultValue={field.key}
                key={field.key}
                onBlur={(e) => setKeyError(e.target.value === field.key ? undefined : onSetKey(e.target.value))}
              />
            )}
          </Field>
          {keyError && <p className="mt-1 text-xs text-destructive">{keyError}</p>}
        </div>
      </details>
    </div>
  );
}
