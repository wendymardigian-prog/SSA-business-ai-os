"use client";

import { Plus } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { FIELD_TYPE_LABELS, FORM_FIELD_TYPES, type FormFieldType } from "@/lib/forms/fields";
import { FIELD_ICONS } from "./field-icons";

/** "+ Agregar campo": elige entre los 14 tipos. */
export function FieldTypePicker({ onPick, disabled }: { onPick: (type: FormFieldType) => void; disabled?: boolean }) {
  return (
    <Popover
      label="Agregar campo"
      align="start"
      panelClassName="w-72 p-2"
      closeOnSelect
      triggerClassName={`inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent ${disabled ? "pointer-events-none opacity-50" : ""}`}
      trigger={
        <>
          <Plus className="h-4 w-4" aria-hidden /> Agregar campo
        </>
      }
    >
      <ul className="grid grid-cols-1 gap-0.5" role="list">
        {FORM_FIELD_TYPES.map((type) => {
          const Icon = FIELD_ICONS[type];
          return (
            <li key={type}>
              <button type="button" onClick={() => onPick(type)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                {FIELD_TYPE_LABELS[type]}
              </button>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}
