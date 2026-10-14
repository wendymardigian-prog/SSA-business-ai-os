"use client";

import { useState } from "react";
import { Checkbox, Field, inputClass } from "@/components/agents/fields";
import { describeAccepted } from "@/components/forms/public/fields/file-field";
import { EodNumberSettings } from "@/components/eod/editor/eod-number-settings";
import { SOCIAL_LABELS, SOCIAL_PLATFORMS, isSocialPlatform } from "@/lib/contacts/social";
import { ATTRIBUTION_KEYS } from "@/lib/attribution/keys";
import { ALLOWED_UPLOAD_MIMES, FILE_LIMITS, MAX_PREFILL_PARAMS, PREFILL_PARAM_RE, socialDefaultLabel, type FormField, type PrefillBehavior } from "@/lib/forms/fields";

/**
 * Los controles propios de cada tipo de pregunta, sueltos para que los comparta el panel de la pregunta del
 * constructor (plano formularios-ui, F11) y el editor de las preguntas de cada canal de un reporte de fin de dia.
 * Mismos datos y mismas reglas de siempre; solo cambia donde se dibujan. Nada de secciones plegables.
 */

type Patch = (patch: Partial<FormField>) => void;

/** Red social de un campo `social`: si la etiqueta todavia es la automatica de la red anterior, acompaña a la nueva. */
export function SocialControl({ field, disabled, onPatch }: { field: FormField; disabled: boolean; onPatch: Patch }) {
  if (field.type !== "social" || !field.social) return null;
  return (
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
  );
}

/** Minimo y maximo de un numero de un formulario (un reporte de fin de dia usa `EodNumberSettings`). */
export function NumberControl({ field, disabled, isEod, onPatch }: { field: FormField; disabled: boolean; isEod: boolean; onPatch: Patch }) {
  if (field.type !== "number") return null;
  if (isEod) return <EodNumberSettings field={field} disabled={disabled} onPatch={onPatch} />;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Mínimo">
        {(id) => <input id={id} type="number" className={inputClass} disabled={disabled} value={field.min ?? ""} onChange={(e) => onPatch({ min: e.target.value === "" ? undefined : Number(e.target.value) })} />}
      </Field>
      <Field label="Máximo">
        {(id) => <input id={id} type="number" className={inputClass} disabled={disabled} value={field.max ?? ""} onChange={(e) => onPatch({ max: e.target.value === "" ? undefined : Number(e.target.value) })} />}
      </Field>
    </div>
  );
}

export function FileControl({ field, disabled, onPatch }: { field: FormField; disabled: boolean; onPatch: Patch }) {
  if (field.type !== "file" || !field.file) return null;
  const file = field.file;
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-semibold">Archivo</legend>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tamaño máximo (MB)">
          {(id) => <input id={id} type="number" min={1} max={FILE_LIMITS.maxMb} className={inputClass} disabled={disabled} value={file.maxMb} onChange={(e) => onPatch({ file: { ...file, maxMb: Number(e.target.value) } })} />}
        </Field>
        <Field label="Cantidad máxima">
          {(id) => <input id={id} type="number" min={1} max={FILE_LIMITS.maxFiles} className={inputClass} disabled={disabled} value={file.maxFiles} onChange={(e) => onPatch({ file: { ...file, maxFiles: Number(e.target.value) } })} />}
        </Field>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-semibold">Tipos permitidos</p>
        {ALLOWED_UPLOAD_MIMES.map((mime) => (
          <Checkbox
            key={mime}
            checked={file.accept.includes(mime)}
            onChange={(on) => onPatch({ file: { ...file, accept: on ? [...file.accept, mime] : file.accept.filter((m) => m !== mime) } })}
            label={describeAccepted([mime])}
          />
        ))}
      </div>
    </fieldset>
  );
}

export function ConsentControl({ field, disabled, onPatch }: { field: FormField; disabled: boolean; onPatch: Patch }) {
  if (field.type !== "consent") return null;
  return (
    <Field label="Texto del consentimiento">
      {(id) => <textarea id={id} rows={2} className={inputClass} disabled={disabled} value={field.consentText ?? ""} maxLength={500} onChange={(e) => onPatch({ consentText: e.target.value })} />}
    </Field>
  );
}

/**
 * De donde sale el valor de un campo oculto. La atribucion de la visita (UTM, ids de clic, cookies) se guarda sola en
 * cada respuesta (plano formularios-ui, D12), asi que ya no se ofrece como fuente nueva; un oculto que YA la usa
 * sigue funcionando y se muestra en solo lectura.
 */
export function HiddenControl({ field, disabled, onPatch, offerAttribution = false }: { field: FormField; disabled: boolean; onPatch: Patch; offerAttribution?: boolean }) {
  if (field.type !== "hidden" || !field.hidden) return null;
  const hidden = field.hidden;
  const legacyAttribution = hidden.source === "attribution";
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-semibold">De dónde sale el valor</legend>
      <Field label="Fuente">
        {(id) => (
          <select
            id={id}
            className={inputClass}
            disabled={disabled}
            value={hidden.source}
            onChange={(e) => {
              const source = e.target.value as "url_param" | "fixed" | "attribution";
              onPatch({ hidden: source === "fixed" ? { source, value: "" } : { source, param: source === "attribution" ? "utm_campaign" : field.key } });
            }}
          >
            <option value="url_param">Un parámetro de la dirección</option>
            <option value="fixed">Un valor fijo</option>
            {(offerAttribution || legacyAttribution) && <option value="attribution">Atribución de la visita (ya se guarda sola)</option>}
          </select>
        )}
      </Field>
      {hidden.source === "url_param" && (
        <Field label="Parámetro" hint="Por ejemplo ref. Se toma de la dirección de la página donde está el formulario. Las UTM y los datos de los anuncios no hace falta agregarlos: se guardan solos.">
          {(id) => <input id={id} className={inputClass} disabled={disabled} value={hidden.param ?? ""} onChange={(e) => onPatch({ hidden: { source: "url_param", param: e.target.value.trim() } })} />}
        </Field>
      )}
      {hidden.source === "attribution" && (
        <Field label="Dato" hint="Toma el de la visita aunque la persona haya navegado a otra página antes de llegar. Esto ya se guarda solo en cada respuesta; este campo sigue funcionando.">
          {(id) => (
            <select id={id} className={inputClass} disabled={disabled} value={hidden.param ?? "utm_campaign"} onChange={(e) => onPatch({ hidden: { source: "attribution", param: e.target.value } })}>
              {ATTRIBUTION_KEYS.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {hidden.source === "fixed" && (
        <Field label="Valor" hint="Lo pone el servidor al guardar. Nunca viaja al navegador de quien responde.">
          {(id) => <input id={id} className={inputClass} disabled={disabled} value={hidden.value ?? ""} maxLength={500} onChange={(e) => onPatch({ hidden: { source: "fixed", value: e.target.value } })} />}
        </Field>
      )}
    </fieldset>
  );
}

const BEHAVIOR_LABELS: Record<PrefillBehavior, string> = {
  editable: "Editable (aparece lleno y se puede cambiar)",
  locked: "Bloqueado (aparece lleno y no se puede cambiar)",
  hidden: "Ocultar si viene lleno (se envía igual)",
};

/** "Prellenar desde la dirección": los parametros que llenan el campo (por defecto su clave) y como se comporta. */
export function PrefillControl({ field, fields, disabled, onPatch }: { field: FormField; fields: FormField[]; disabled: boolean; onPatch: Patch }) {
  const [paramDraft, setParamDraft] = useState("");
  const [paramError, setParamError] = useState<string | undefined>();
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
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold">Prellenar desde la dirección</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Si el link trae <code className="rounded bg-muted px-1 font-mono">?{prefill.params[0]}=…</code>, el campo aparece completado. Se usa el primer parámetro que venga con valor.
        </p>
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
    </div>
  );
}

/** La clave de la pregunta: identifica la respuesta en `{{answer.clave}}`. Se cambia solo mientras el formulario nunca se publico. */
export function KeyControl({
  field,
  neverPublished,
  disabled,
  isEod,
  onSetKey,
}: {
  field: FormField;
  neverPublished: boolean;
  disabled: boolean;
  isEod: boolean;
  onSetKey: (key: string) => string | undefined;
}) {
  const [keyError, setKeyError] = useState<string | undefined>();
  const token = isEod ? "{{answer.clave}} o {{channel.canal.clave}}" : "{{answer.clave}}";
  return (
    <div>
      <Field
        label="Clave"
        hint={
          neverPublished
            ? `Identifica este campo en las respuestas y en las automatizaciones (${token}). Podés cambiarla mientras el formulario no se publicó.`
            : `Identifica este campo en las respuestas y en las automatizaciones (${token}). Ya se publicó: cambiarla puede romper flows que la usan, por eso no se puede.`
        }
      >
        {(id) => (
          <input
            id={id}
            className={`${inputClass} font-mono text-[12.5px]`}
            disabled={disabled || !neverPublished}
            defaultValue={field.key}
            key={field.key}
            onBlur={(e) => setKeyError(e.target.value === field.key ? undefined : onSetKey(e.target.value))}
          />
        )}
      </Field>
      {keyError && <p className="mt-1 text-xs text-destructive">{keyError}</p>}
    </div>
  );
}
