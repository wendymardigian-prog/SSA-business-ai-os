"use client";

import { memo, type DragEvent } from "react";
import { ArrowDown, ArrowUp, Copy, GitBranch, GripVertical, Trash2 } from "lucide-react";
import { FIELD_TYPE_LABELS, type FormField } from "@/lib/forms/fields";
import { cn } from "@/lib/utils";
import { FIELD_ICONS } from "./field-icons";
import { InertControl } from "./inert-control";

/** Lo que la tarjeta puede pedirle al lienzo. El lienzo lo arma una sola vez, asi la tarjeta no se redibuja de mas. */
export interface CardActions {
  select(id: string): void;
  relabel(id: string, label: string): void;
  move(id: string, delta: -1 | 1): void;
  duplicate(id: string): void;
  remove(id: string): void;
  dragStart(id: string, event: DragEvent<HTMLElement>): void;
  dragOver(id: string, event: DragEvent<HTMLElement>): void;
  drop(id: string, event: DragEvent<HTMLElement>): void;
  dragEnd(): void;
}

export interface QuestionCardProps {
  field: FormField;
  index: number;
  count: number;
  selected: boolean;
  /** Sin permiso o archivado: no se escribe, no se arrastra, no hay acciones. */
  disabled: boolean;
  /** "Si ¿Qué negocio tenés? = Otro" */
  conditionChip: string | null;
  /** "→ Email" */
  mappingChip: string | null;
  /** Un reporte de fin de dia: sin condiciones ni contacto; muestra lo que mide. */
  extraChip: string | null;
  /** Lo que falta para publicar, ya unido con saltos de linea (un texto, para que `memo` compare por valor). */
  problems: string;
  dropIndicator: "before" | "after" | null;
  actions: CardActions;
}

const smallBtn = "rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

function QuestionCardImpl({ field, index, count, selected, disabled, conditionChip, mappingChip, extraChip, problems, dropIndicator, actions }: QuestionCardProps) {
  const Icon = FIELD_ICONS[field.type];
  const name = field.label || FIELD_TYPE_LABELS[field.type];
  const problemList = problems ? problems.split("\n") : [];

  return (
    <li
      id={`q-${field.id}`}
      aria-current={selected || undefined}
      onClick={() => actions.select(field.id)}
      onDragOver={(e) => actions.dragOver(field.id, e)}
      onDrop={(e) => actions.drop(field.id, e)}
      className={cn(
        "group relative rounded-xl border bg-card p-3 transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40",
        problemList.length > 0 && !selected && "border-red-400 dark:border-red-500/60",
      )}
    >
      {dropIndicator && <span aria-hidden className={cn("pointer-events-none absolute inset-x-2 h-0.5 rounded bg-primary", dropIndicator === "before" ? "-top-[7px]" : "-bottom-[7px]")} />}

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {!disabled && (
          <span
            draggable
            role="img"
            aria-label={`Arrastrar ${name}`}
            title="Arrastrá para cambiar el orden"
            onDragStart={(e) => actions.dragStart(field.id, e)}
            onDragEnd={actions.dragEnd}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab rounded p-0.5 hover:bg-accent active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </span>
        )}
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="shrink-0">{FIELD_TYPE_LABELS[field.type]}</span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {conditionChip && (
            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              <GitBranch className="h-3 w-3 shrink-0" aria-hidden /> <span className="truncate">{conditionChip}</span>
            </span>
          )}
          {mappingChip && <span className="truncate rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] text-primary">{mappingChip}</span>}
          {extraChip && <span className="truncate rounded-full bg-muted px-2 py-0.5 text-[10.5px]">{extraChip}</span>}
        </span>
        {!disabled && (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-aria-[current=true]:opacity-100">
            <button type="button" aria-label={`Subir ${name}`} disabled={index === 0} onClick={(e) => (e.stopPropagation(), actions.move(field.id, -1))} className={smallBtn}>
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" aria-label={`Bajar ${name}`} disabled={index === count - 1} onClick={(e) => (e.stopPropagation(), actions.move(field.id, 1))} className={smallBtn}>
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" aria-label={`Duplicar ${name}`} onClick={(e) => (e.stopPropagation(), actions.duplicate(field.id))} className={smallBtn}>
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" aria-label={`Borrar ${name}`} onClick={(e) => (e.stopPropagation(), actions.remove(field.id))} className={`${smallBtn} hover:text-destructive`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-1">
        <input
          aria-label="Texto de la pregunta"
          value={field.label}
          disabled={disabled}
          maxLength={200}
          placeholder={FIELD_TYPE_LABELS[field.type]}
          onFocus={() => actions.select(field.id)}
          onChange={(e) => actions.relabel(field.id, e.target.value)}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-medium hover:border-border focus:border-ring focus:outline-none disabled:opacity-100"
        />
        {field.required && field.type !== "hidden" && <span aria-label="Obligatoria" className="text-red-600">*</span>}
      </div>
      {field.help && field.type !== "hidden" && <p className="px-1 text-xs text-muted-foreground">{field.help}</p>}
      <div className="mt-2 px-1">
        <InertControl field={field} />
      </div>

      {problemList.length > 0 && (
        <ul className="mt-2 space-y-0.5 px-1 text-xs text-red-600 dark:text-red-400">
          {problemList.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export const QuestionCard = memo(QuestionCardImpl);
