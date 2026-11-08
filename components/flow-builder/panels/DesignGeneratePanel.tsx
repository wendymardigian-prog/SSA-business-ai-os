"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { templatesForAutomation, templateVariablesForAutomation } from "@/lib/actions/designer/automate";
import {
  DESIGN_OUTPUTS_HELP,
  designGenerateDefaults,
  groupVariableOptions,
  mappingToSelect,
  MISSING_POLICY_LABELS,
  parseMapping,
  selectToMapping,
  variableOptionLabel,
  type DesignGenerateNodeData,
  type MappingRow,
  type NodeMissingPolicy,
} from "@/lib/designer/automation/node-config";
import { VariableChips } from "./variable-chips";

/**
 * Configuración de «Generar desde plantilla» (Diseñador IA, F57): la plantilla, con qué se llena cada variable, qué
 * hacer si falta un dato, publicar con link y esperar el PDF. La lógica es de `lib/designer/automation/node-config.ts`.
 */

const fieldClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";

type TemplateOption = { id: string; name: string; format: string; docNoun: string | null };

export function DesignGeneratePanel({
  data,
  onChange,
  availableVariables,
  variableLabels,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  availableVariables?: string[];
  /** El rótulo de cada variable del disparador (el texto de la pregunta…), por ruta. */
  variableLabels?: Record<string, string>;
}) {
  const node = data as DesignGenerateNodeData & Record<string, unknown>;
  const cfg = designGenerateDefaults(node);
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  // Las filas quedan atadas a la plantilla que las pidió: al cambiar de plantilla, las viejas no se muestran.
  const [loaded, setLoaded] = useState<{ templateId: string; rows: MappingRow[] | null; error: string | null } | null>(null);
  const templateId = typeof node.templateId === "string" ? node.templateId : "";
  const current = loaded && loaded.templateId === templateId ? loaded : null;
  const rows = current?.rows ?? null;
  const rowsError = current?.error ?? null;
  const groups = groupVariableOptions(availableVariables ?? []);

  useEffect(() => {
    let alive = true;
    templatesForAutomation()
      .then((res) => {
        if (!alive) return;
        if (res.ok) setTemplates(res.data);
        else setTemplatesError(res.error);
      })
      .catch(() => alive && setTemplatesError("No pude cargar las plantillas."));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!templateId) return;
    let alive = true;
    templateVariablesForAutomation({ templateId })
      .then((res) => {
        if (alive) setLoaded({ templateId, rows: res.ok ? res.data.rows : null, error: res.ok ? null : res.error });
      })
      .catch(() => alive && setLoaded({ templateId, rows: null, error: "No pude cargar las variables de la plantilla." }));
    return () => {
      alive = false;
    };
  }, [templateId]);

  const mappings = (node.mappings ?? {}) as Record<string, unknown>;
  const setMapping = (key: string, value: unknown) => onChange({ ...node, mappings: { ...mappings, [key]: value } });

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="design-template" className={labelClass}>
          Plantilla
        </label>
        {templates === null && !templatesError ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Cargando plantillas…
          </p>
        ) : templatesError ? (
          <p className="text-sm text-destructive">{templatesError}</p>
        ) : templates && templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay plantillas.{" "}
            <Link href="/dashboard/disenos" className="font-medium text-primary-ink underline-offset-2 hover:underline">
              Creá una en el Diseñador IA
            </Link>
            .
          </p>
        ) : (
          <select
            id="design-template"
            value={templateId}
            onChange={(e) => {
              const picked = templates?.find((t) => t.id === e.target.value);
              onChange({ ...node, templateId: picked?.id || undefined, templateName: picked?.name, mappings: {} });
            }}
            className={fieldClass}
          >
            <option value="">Elegí una plantilla…</option>
            {(templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {templateId && !(templates ?? []).some((t) => t.id === templateId) ? (
              <option value={templateId}>{node.templateName ?? "Plantilla elegida"} (archivada o sin acceso)</option>
            ) : null}
          </select>
        )}
      </div>

      <div>
        <p className={labelClass}>Para</p>
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">El contacto del disparador</p>
      </div>

      {templateId ? (
        <div>
          <p className={labelClass}>Con qué se llena cada variable</p>
          <p className="-mt-1 mb-2 text-[11px] text-muted-foreground">
            Por defecto, cada variable usa el valor de la plantilla (del contacto o su valor por defecto). Acá podés cambiarlo por cualquier dato del flujo, por ejemplo una respuesta del formulario.
          </p>
          {rows === null && !rowsError ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Cargando variables…
            </p>
          ) : rowsError ? (
            <p className="text-sm text-destructive">{rowsError}</p>
          ) : rows && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Esta plantilla no usa variables que haya que llenar.</p>
          ) : (
            <ul className="space-y-3">
              {(rows ?? []).map((row) => {
                const selectValue = mappingToSelect(mappings[row.key]);
                const mapping = parseMapping(mappings[row.key]);
                const text = mapping && (mapping.mode === "text" || mapping.mode === "combine") ? mapping.text : "";
                const id = `design-var-${row.key.replace(/[^a-z0-9]/gi, "-")}`;
                return (
                  <li key={row.key} className="rounded-lg border border-border p-2.5">
                    <label htmlFor={id} className="mb-1.5 flex items-center gap-2 text-xs">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary-ink">{row.label}</span>
                      <span className="text-muted-foreground">{row.group}</span>
                      {row.required ? <span className="text-muted-foreground">· obligatoria</span> : null}
                    </label>
                    <select id={id} value={selectValue} onChange={(e) => setMapping(row.key, selectToMapping(e.target.value, mappings[row.key]))} className={fieldClass}>
                      <option value="template">Valor de la plantilla</option>
                      {groups.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.vars.map((v) => (
                            <option key={v} value={`var:${v}`}>
                              {variableOptionLabel(v, variableLabels)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                      <optgroup label="Otros">
                        <option value="today">Fecha de hoy</option>
                        <option value="text">Texto fijo…</option>
                        <option value="combine">Combinar…</option>
                      </optgroup>
                    </select>
                    {mapping && (mapping.mode === "text" || mapping.mode === "combine") ? (
                      <div className="mt-2">
                        <input
                          aria-label={mapping.mode === "text" ? `Texto fijo para ${row.label}` : `Combinación para ${row.label}`}
                          value={text}
                          onChange={(e) => setMapping(row.key, { mode: mapping.mode, text: e.target.value })}
                          placeholder={mapping.mode === "text" ? "El texto que va siempre" : "{{answer.nombre}} {{answer.apellido}}"}
                          className={fieldClass}
                        />
                        {mapping.mode === "combine" ? (
                          <VariableChips variables={availableVariables} onInsert={(token) => setMapping(row.key, { mode: "combine", text: `${text}${text && !text.endsWith(" ") ? " " : ""}${token}` })} />
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <div>
        <label htmlFor="design-missing" className={labelClass}>
          Si falta un dato
        </label>
        <select id="design-missing" value={cfg.missingPolicy} onChange={(e) => onChange({ ...node, missingPolicy: e.target.value as NodeMissingPolicy })} className={fieldClass}>
          {(Object.keys(MISSING_POLICY_LABELS) as NodeMissingPolicy[]).map((key) => (
            <option key={key} value={key}>
              {MISSING_POLICY_LABELS[key]}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-muted-foreground/70">Con «No generar y avisarme», el camino termina con «Falta: …» y se avisa en la campana. Nunca sale una pieza con un dato vacío sin que lo elijas.</p>
      </div>

      <label className="flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" className="mt-0.5" checked={cfg.publish} onChange={(e) => onChange({ ...node, publish: e.target.checked })} />
        <span>Publicar con link</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" className="mt-0.5" checked={cfg.waitForPdf} onChange={(e) => onChange({ ...node, waitForPdf: e.target.checked })} />
        <span>
          Esperar el PDF antes de seguir
          <span className="block text-[11px] text-muted-foreground">Dejalo prendido si un paso siguiente adjunta el PDF.</span>
        </span>
      </label>

      <p className="rounded-lg bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">{DESIGN_OUTPUTS_HELP}</p>
    </div>
  );
}
