"use client";

import { Field, Notice, inputClass } from "./fields";

/**
 * El selector de proveedor + modelo, compartido por el agente de chat (su
 * modelo principal y el de respaldo) y por las tareas de IA con modelo
 * elegible. Solo ofrece proveedores de texto con key activa; si el que estaba
 * guardado ya no esta conectado lo dice, en vez de mostrar otro en silencio.
 */

/** Lo unico que necesita para dibujarse. `AgentScreenData` lo cumple tal cual. */
export interface ModelPickerData {
  /** Proveedores de texto con key activa. Lo unico que se puede elegir. */
  providers: Array<{ provider: string; label: string; defaultModel: string; models: string[] }>;
  /** Etiquetas del catalogo para nombrar un proveedor guardado que ya no esta conectado. */
  providerLabels: Record<string, string>;
  /** "proveedor/modelo" con precio cargado en model_pricing. */
  pricedModels: string[];
}

export function ModelPicker({
  label,
  provider,
  model,
  onChange,
  data,
  optional,
}: {
  label: string;
  provider: string | null;
  model: string | null;
  onChange: (provider: string | null, model: string | null) => void;
  data: ModelPickerData;
  optional?: boolean;
}) {
  const connected = data.providers.find((p) => p.provider === provider);
  const unavailable = provider !== null && !connected;
  const models = connected?.models ?? [];
  const priced = provider && model ? data.pricedModels.includes(`${provider}/${model}`) : true;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label={`${label}: proveedor`}>
        {(id) => (
          <select
            id={id}
            value={provider ?? ""}
            onChange={(e) => {
              const next = e.target.value || null;
              const def = data.providers.find((p) => p.provider === next);
              onChange(next, next ? def?.defaultModel || null : null);
            }}
            className={`${inputClass} ${unavailable ? "border-red-500 text-red-700 dark:text-red-400" : ""}`}
            aria-invalid={unavailable || undefined}
          >
            {optional && <option value="">Sin respaldo</option>}
            {!optional && provider === null && <option value="">Elegí un proveedor</option>}
            {unavailable && (
              <option value={provider ?? ""}>
                {data.providerLabels[provider ?? ""] ?? provider} (no conectado)
              </option>
            )}
            {data.providers.map((p) => (
              <option key={p.provider} value={p.provider}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`${label}: modelo`}>
        {(id) => (
          <select
            id={id}
            value={model ?? ""}
            onChange={(e) => onChange(provider, e.target.value || null)}
            disabled={!provider || unavailable}
            className={inputClass}
          >
            {model && !models.includes(model) && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </Field>
      {unavailable && (
        <div className="md:col-span-2">
          <Notice tone="error">
            El proveedor configurado ya no está conectado. El agente no va a poder usarlo: conectalo en Integraciones o elegí otro.
          </Notice>
        </div>
      )}
      {!unavailable && !priced && (
        <div className="md:col-span-2">
          <Notice tone="warning">
            Este modelo no tiene precio cargado: los runs se van a guardar con el costo sin calcular. Hay que sumarlo a la tabla de precios.
          </Notice>
        </div>
      )}
    </div>
  );
}
