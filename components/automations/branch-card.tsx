"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, MoreHorizontal, Plus, Split, Trash2 } from "lucide-react";
import { PopoverMenu, type MenuItem } from "@/components/automations/popover-menu";
import { PathConditions } from "@/components/automations/path-conditions";
import { StepList } from "@/components/automations/step-list";
import { useStepEditor } from "@/components/automations/step-tree-context";
import { cn } from "@/lib/utils";
import { canAddPath, canRemovePath, pathDisplayLabel } from "@/lib/automations/branch-edit";
import { conditionProblem, describePathConditions, fieldOfCondition, looksIncomplete, recognizedFields } from "@/lib/automations/condition-builder-model";
import {
  addBranchPathWithDefault,
  conditionGroupsFor,
  convertGate,
  moveBranchPath,
  patchBranchPath,
  removeBranchPath,
  removeStep,
  renameBranch,
  renameBranchPath,
  stepsInside,
} from "@/lib/automations/step-tree-edit";
import { gateConditions, type BranchPathStep, type BranchStep, type GateStep } from "@/lib/automations/step-tree";
import { describeGroup } from "@/lib/flow-engine/condition-eval";
import { BRANCH_ELSE_LABEL, MAX_PATHS, newPathId } from "@/lib/flow-engine/branch-paths";

/**
 * Condiciones: una tarjeta con un bloque por camino (en orden) y al final el
 * bloque fijo "Si no". Los caminos van SIEMPRE uno debajo del otro, con
 * sangria y un color por camino, en la compu y en el celular: lado a lado no
 * entran tres niveles. Cada camino termina en si mismo.
 */

const TONES = [
  { border: "border-indigo-400", badge: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  { border: "border-emerald-400", badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  { border: "border-amber-400", badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  { border: "border-sky-400", badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  { border: "border-rose-400", badge: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  { border: "border-violet-400", badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
];

const nameInputClass = "h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm font-medium";
const iconButton =
  "rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30";

export function BranchCard({ step }: { step: BranchStep }) {
  const { tree, catalog, edit, disabled, ask } = useStepEditor();
  // Los caminos con algo por completar nacen abiertos (para que se complete); despues manda lo que se toque.
  // No se vuelven a cerrar solos cuando se completan: seria cerrarle el panel a quien esta escribiendo.
  const [autoOpen] = useState(() => new Set(step.paths.filter((p) => p.conditions.length === 0 || p.conditions.some(looksIncomplete)).map((p) => p.id)));
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => conditionGroupsFor(tree, step.id, catalog), [tree, step.id, catalog]);
  const fields = useMemo(() => recognizedFields(groups), [groups]);
  const label = typeof step.data.label === "string" ? step.data.label : "";
  const inside = stepsInside(step);

  function removePathAsking(path: BranchPathStep, index: number) {
    const count = stepsInside({ kind: "branch", id: "", data: {}, paths: [path], otherwise: [] });
    const run = () => edit((t) => removeBranchPath(t, step.id, path.id));
    if (count === 0) run();
    else
      ask(
        { title: "Borrar el camino", message: `«${pathDisplayLabel(path, index)}» tiene ${count} ${count === 1 ? "paso" : "pasos"}. Si lo borrás, se borran también.`, confirmLabel: "Borrar el camino" },
        run,
      );
  }

  const menu: MenuItem[] = [
    {
      key: "delete",
      label: "Borrar Condiciones",
      destructive: true,
      onSelect: () => {
        const run = () => edit((t) => removeStep(t, step.id));
        if (inside === 0) run();
        else ask({ title: "Borrar Condiciones", message: `Tiene ${inside} ${inside === 1 ? "paso" : "pasos"} adentro de sus caminos. Si lo borrás, se borran también.`, confirmLabel: "Borrar" }, run);
      },
    },
  ];

  return (
    <div className="space-y-3 rounded-lg border border-indigo-300 bg-card p-3 dark:border-indigo-800" data-step-id={step.id}>
      <div className="flex items-center gap-2">
        <Split className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
        <input
          aria-label="Nombre de las Condiciones"
          placeholder="Condiciones"
          value={label}
          disabled={disabled}
          onChange={(e) => edit((t) => renameBranch(t, step.id, e.target.value))}
          className={cn(nameInputClass, "border-transparent bg-transparent hover:border-input")}
        />
        <PopoverMenu
          align="right"
          disabled={disabled}
          items={menu}
          triggerLabel="Opciones de Condiciones"
          trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
          triggerClassName={iconButton}
        />
      </div>
      <p className="text-xs text-muted-foreground">Va por el primer camino que se cumple, en este orden. Si no se cumple ninguno, por «{BRANCH_ELSE_LABEL}».</p>

      {step.paths.map((path, index) => {
        const tone = TONES[index % TONES.length];
        // Hasta que no cargan los campos no se puede juzgar nada (todo parecería "ya no existe").
        const problem = catalog !== null && (path.conditions.length === 0 || path.conditions.some((c) => conditionProblem(c, fieldOfCondition(fields, c.field)) !== null));
        const expanded = open[path.id] ?? autoOpen.has(path.id);
        const name = pathDisplayLabel(path, index);
        const summary = describePathConditions({ logic: path.logic, conditions: path.conditions }, fields);
        return (
          <section key={path.id} aria-label={`Camino ${name}`} className={cn("space-y-2 border-l-4 pl-3", tone.border)}>
            <div className="flex items-center gap-1.5">
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone.badge)}>{index + 1}</span>
              <input
                aria-label={`Nombre del camino ${index + 1}`}
                placeholder={`Camino ${index + 1}`}
                value={path.label}
                disabled={disabled}
                onChange={(e) => edit((t) => renameBranchPath(t, step.id, path.id, e.target.value))}
                className={nameInputClass}
              />
              <button type="button" disabled={disabled || index === 0} aria-label={`Subir el camino ${name}`} onClick={() => edit((t) => moveBranchPath(t, step.id, path.id, -1))} className={iconButton}>
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={disabled || index === step.paths.length - 1}
                aria-label={`Bajar el camino ${name}`}
                onClick={() => edit((t) => moveBranchPath(t, step.id, path.id, 1))}
                className={iconButton}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={disabled || !canRemovePath(step.paths.length)}
                aria-label={`Borrar el camino ${name}`}
                title={canRemovePath(step.paths.length) ? undefined : "Tiene que quedar al menos un camino"}
                onClick={() => removePathAsking(path, index)}
                className={cn(iconButton, "hover:text-red-600")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen((o) => ({ ...o, [path.id]: !expanded }))}
                className="flex w-full items-start gap-1 rounded-md text-left text-xs hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {expanded ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span>
                  <span className="text-muted-foreground">Se cumple si: </span>
                  <span className={cn("font-medium", problem && "text-amber-700 dark:text-amber-300")}>{summary}</span>
                </span>
              </button>
              {expanded && (
                <div className="mt-2 rounded-lg bg-muted/40 p-2">
                  {catalog === null ? (
                    <p className="text-xs text-muted-foreground">Cargando los campos para comparar…</p>
                  ) : (
                    <PathConditions path={path} groups={groups} disabled={disabled} onChange={(next) => edit((t) => patchBranchPath(t, step.id, path.id, next))} />
                  )}
                </div>
              )}
            </div>

            <StepList steps={path.steps} listRef={{ where: "path", stepId: step.id, pathId: path.id }} emptyText="Este camino no hace nada todavía." />
          </section>
        );
      })}

      <button
        type="button"
        disabled={disabled || !canAddPath(step.paths.length)}
        onClick={() => {
          // El camino nuevo nace abierto: lo primero que hay que hacer es completar su condicion.
          const id = newPathId(step.paths.map((p) => p.id));
          edit((t) => addBranchPathWithDefault(t, step.id, catalog, undefined, id));
          setOpen((o) => ({ ...o, [id]: true }));
        }}
        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <Plus className="h-4 w-4" aria-hidden /> {canAddPath(step.paths.length) ? "Camino" : `Máximo ${MAX_PATHS} caminos`}
      </button>

      <section aria-label={BRANCH_ELSE_LABEL} className="space-y-2 border-l-4 border-muted-foreground/40 pl-3">
        <div>
          <p className="text-sm font-semibold">{BRANCH_ELSE_LABEL}</p>
          <p className="text-xs text-muted-foreground">Si no se cumple ninguna de las anteriores. Siempre está al final y no se borra.</p>
        </div>
        <StepList steps={step.otherwise} listRef={{ where: "else", stepId: step.id }} emptyText="Si no se cumple ninguno, el flujo termina acá." />
      </section>
    </div>
  );
}

/**
 * El "Si" plano de siempre (un nodo Condicion con una sola salida): lo de abajo
 * solo corre si se cumple. No se crea ni se edita desde aca; se puede
 * convertir en Condiciones, que es lo que ofrece hoy el editor.
 */
export function GateCard({ step }: { step: GateStep }) {
  const { edit, disabled, ask } = useStepEditor();
  const conditions = gateConditions(step.data);
  const summary = describeGroup({ logic: step.data.logic === "and" ? "and" : "or", conditions: conditions as never });
  const inside = stepsInside(step);

  const menu: MenuItem[] = [
    {
      key: "delete",
      label: "Borrar el Si",
      destructive: true,
      onSelect: () => {
        const run = () => edit((t) => removeStep(t, step.id));
        if (inside === 0) run();
        else ask({ title: "Borrar el Si", message: `Tiene ${inside} ${inside === 1 ? "paso" : "pasos"} adentro. Si lo borrás, se borran también.`, confirmLabel: "Borrar" }, run);
      },
    },
  ];

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-amber-400 bg-card p-3" data-step-id={step.id}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Si se cumple: {summary}</p>
          <p className="text-xs text-muted-foreground">Los pasos de abajo solo corren si se cumple. Es una condición de un solo camino; con Condiciones podés tener varios y un «Si no».</p>
        </div>
        <PopoverMenu align="right" disabled={disabled} items={menu} triggerLabel="Opciones del Si" trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />} triggerClassName={iconButton} />
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => edit((t) => convertGate(t, step.id))}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        Convertir a Condiciones
      </button>
      <div className="border-l-4 border-amber-300 pl-3">
        <StepList steps={step.steps} listRef={{ where: "gate", stepId: step.id }} emptyText="Todavía no hay pasos después del Si." />
      </div>
    </div>
  );
}
