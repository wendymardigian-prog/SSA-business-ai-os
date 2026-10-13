"use client";

import { Fragment } from "react";
import { Plus, Split } from "lucide-react";
import { PopoverMenu, type MenuItem } from "@/components/automations/popover-menu";
import { ActionCard } from "@/components/automations/step-card";
import { BranchCard, GateCard } from "@/components/automations/branch-card";
import { useStepEditor } from "@/components/automations/step-tree-context";
import { actionKindsFor, newActionStep } from "@/lib/automations/step-catalog";
import { canAddBranchAt, canInsertAt, insertMovesTail, insertNewBranch, insertStep, newBranchStep, type ListRef } from "@/lib/automations/step-tree-edit";
import { allIds, MAX_BRANCH_DEPTH, type Step } from "@/lib/automations/step-tree";

/**
 * Una lista de pasos, uno debajo del otro, con "+ Agregar paso" entre cada uno
 * y al final. Despues de un "Si" o de Condiciones no hay "+": lo que sigue va
 * ADENTRO (cada camino termina en si mismo).
 */

export function StepList({ steps, listRef, emptyText }: { steps: Step[]; listRef: ListRef; emptyText?: string }) {
  return (
    <div className="space-y-1.5">
      {steps.length === 0 && emptyText && <p className="text-xs text-muted-foreground">{emptyText}</p>}
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          <AddStep listRef={listRef} index={index} steps={steps} variant="between" />
          {step.kind === "action" && <ActionCard step={step} index={index} steps={steps} />}
          {step.kind === "gate" && <GateCard step={step} />}
          {step.kind === "branch" && <BranchCard step={step} />}
        </Fragment>
      ))}
      {canInsertAt(steps, steps.length) && <AddStep listRef={listRef} index={steps.length} steps={steps} variant={steps.length === 0 ? "empty" : "end"} />}
    </div>
  );
}

function AddStep({ listRef, index, steps, variant }: { listRef: ListRef; index: number; steps: Step[]; variant: "between" | "end" | "empty" }) {
  const { screen, tree, edit, catalog, disabled, announce } = useStepEditor();

  // Entre dos pasos solo se ofrece cuando hay algo antes (arriba del primero tambien: "al principio").
  const kinds = actionKindsFor(screen);
  const branchAllowed = canAddBranchAt(tree, listRef);
  const movesTail = insertMovesTail(steps, index, newBranchStep([]));

  const items: MenuItem[] = [
    ...kinds.map(
      (kind): MenuItem => ({
        key: kind.key,
        label: kind.menuLabel,
        onSelect: () => edit((t) => insertStep(t, listRef, index, newActionStep(kind, allIds(t), undefined, screen))),
      }),
    ),
    { key: "sep", separator: true },
    {
      key: "branch",
      label: (
        <span className="flex items-center gap-1.5">
          <Split className="h-3.5 w-3.5" aria-hidden /> Condiciones
        </span>
      ),
      disabled: !branchAllowed,
      hint: !branchAllowed
        ? `Ya hay ${MAX_BRANCH_DEPTH} niveles de Condiciones. Para más, abrí la automatización en el canvas.`
        : movesTail
          ? "Varios caminos según una respuesta. Los pasos que siguen pasan al primer camino."
          : "Varios caminos según una respuesta, y «Si no».",
      onSelect: () => {
        edit((t) => insertNewBranch(t, listRef, index, catalog));
        if (movesTail) announce("Los pasos que seguían pasaron al primer camino de Condiciones.");
      },
    },
  ];

  if (variant === "between") {
    return (
      <div className="flex justify-center">
        <PopoverMenu
          trigger={
            <span className="inline-flex items-center gap-1">
              <Plus className="h-3 w-3" aria-hidden /> Agregar paso
            </span>
          }
          triggerLabel="Agregar un paso acá"
          items={items}
          disabled={disabled}
          triggerClassName="rounded-full px-2.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
      </div>
    );
  }

  return (
    <PopoverMenu
      trigger={
        <span className="inline-flex items-center gap-1.5">
          <Plus className="h-4 w-4" aria-hidden /> Agregar paso
        </span>
      }
      items={items}
      disabled={disabled}
      triggerClassName={
        variant === "empty"
          ? "rounded-lg border-2 border-dashed border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          : "rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      }
    />
  );
}
