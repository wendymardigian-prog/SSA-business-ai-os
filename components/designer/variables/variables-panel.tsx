"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { primaryButton, inputClass } from "@/components/designer/editor/overlays";
import { Switch } from "@/components/ui/switch";
import type { DesignDoc } from "@/lib/designer/doc/schema";
import { addCustomVar, removeVarWarning, usedVariableRows, variableUsage } from "@/lib/designer/screens/variables";
import { variableGroups, type CustomVar } from "@/lib/designer/variables/catalog";

const CHIP = "inline-block rounded-[0.35em] bg-primary/20 px-1.5 py-0.5 text-xs font-semibold text-primary-ink";

/**
 * La pestaña Variables de una plantilla (F24): cómo se usan (3 pasos), las usadas con su grupo y su valor de ejemplo, las
 * PROPIAS (crear con el nombre en español → clave sin tildes en snake_case; borrar avisa si está en uso), las del
 * sistema y «Ver con datos de ejemplo» (los chips pasan a valores de muestra y no se edita mientras está prendido).
 */
export function VariablesPanel({
  doc,
  customVars,
  verify,
  sample,
  readOnly,
  onSample,
  onChangeVars,
}: {
  doc: DesignDoc;
  customVars: readonly CustomVar[];
  verify: boolean;
  sample: boolean;
  readOnly: boolean;
  onSample: (on: boolean) => void;
  /** La lista nueva de variables propias (el editor la guarda junto con el documento). */
  onChangeVars: (list: CustomVar[]) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<CustomVar | null>(null);
  const used = usedVariableRows(doc, customVars);
  const system = variableGroups({ customVars: [], verify }).filter((g) => g.key !== "propias");

  function add() {
    const result = addCustomVar(customVars, name);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setName("");
    onChangeVars(result.list);
  }

  const askRemove = (v: CustomVar) => (variableUsage(doc, v.key) > 0 ? setConfirm(v) : onChangeVars(customVars.filter((x) => x.key !== v.key)));

  return (
    <div className="flex flex-col gap-4 p-3.5">
      <div className="rounded-[10px] bg-primary/10 p-3 text-[12.5px]">
        <b>Cómo poner una variable</b>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
          <li>Tocá un texto del diseño (o agregá uno).</li>
          <li>
            Tocá <b>Insertar variable</b> arriba del lienzo y elegí cuál.
          </li>
          <li>Aparece resaltada: tocala para cambiarla o quitarla.</li>
        </ol>
      </div>

      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">En esta plantilla ({used.length})</h3>
        {used.length === 0 ? (
          <p className="text-xs text-muted-foreground">Ninguna todavía.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {used.map((v) => (
              <li key={v.key} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className={CHIP} title={`{{${v.key}}}`}>
                  {v.label}
                </span>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {v.group}
                  {v.sample ? ` · ej.: ${v.sample}` : ""}
                  {!v.known && " · esta variable no existe: se generaría vacía"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Variables propias</h3>
        <p className="mb-2 mt-1 text-xs text-muted-foreground">Para datos que no están en el sistema (por ejemplo, el nombre tal como lo quiere en el certificado). Se completan en la automatización o al generar.</p>
        <ul className="mb-2 flex flex-col gap-1.5">
          {customVars.map((v) => (
            <li key={v.key} className="flex items-center gap-2 text-[12.5px]">
              <span className={CHIP}>{v.label}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{`{{${v.key}}}`}</span>
              {!readOnly && (
                <button type="button" aria-label={`Quitar la variable ${v.label}`} onClick={() => askRemove(v)} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Ej.: Nombre en el certificado" aria-label="Nombre de la variable propia" className={inputClass} />
            <button type="submit" className={`${primaryButton} h-9 px-3`}>
              <Plus className="h-4 w-4" aria-hidden /> Agregar
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-1.5 text-xs text-bad">
            {error}
          </p>
        )}
      </section>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Del sistema</h3>
        <p className="mb-1.5 mt-1 text-xs text-muted-foreground">Se completan solas con el contacto, el negocio o el diseño generado.</p>
        {system.map((group) => (
          <div key={group.key} className="mb-2">
            <p className="mb-1 text-xs text-muted-foreground">{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.vars.map((v) => (
                <span key={v.key} className={CHIP} title={`{{${v.key}}}`}>
                  {v.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>

      <label className="flex items-center gap-2 text-[13px]">
        <Switch checked={sample} onChange={onSample} label="Ver con datos de ejemplo" />
        Ver con datos de ejemplo
      </label>

      <ConfirmDialog
        open={!!confirm}
        title="¿Quitar esta variable?"
        message={confirm ? (removeVarWarning(confirm.label, variableUsage(doc, confirm.key)) ?? "") : ""}
        confirmLabel="Quitar"
        cancelLabel="Cancelar"
        destructive
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) onChangeVars(customVars.filter((x) => x.key !== confirm.key));
          setConfirm(null);
        }}
      />
    </div>
  );
}
