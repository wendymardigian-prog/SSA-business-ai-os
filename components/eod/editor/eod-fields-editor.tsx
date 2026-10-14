"use client";

import { useState } from "react";
import { BuilderLayout } from "@/components/forms/builder/builder-layout";
import { FormCanvas } from "@/components/forms/builder/form-canvas";
import { InspectorField } from "@/components/forms/builder/inspector-field";
import { useBuilderActions } from "@/components/forms/builder/use-builder-actions";
import { addEodField } from "@/lib/eod/builder";
import { defaultEodSelection, normalizeSelection, selectedIndex, type BuilderSelection } from "@/lib/forms/builder-selection";
import { FIELD_TYPE_LABELS, type FormField } from "@/lib/forms/fields";

/**
 * Las preguntas de un reporte de fin de dia con su panel: las usan las preguntas generales y cada canal. Es el mismo
 * lienzo y el mismo panel que el de un formulario (plano formularios-ui, F9-F11), limitado a los cinco tipos de un
 * EOD y sin titulo, boton, pantalla final, contacto ni condiciones. Solo compone: las reglas viven en
 * `lib/forms/builder*.ts` y `lib/eod/`.
 */
export function EodFieldsEditor({
  fields,
  onChange,
  disabled,
  neverPublished,
  label,
  emptyText = "Todavía no hay preguntas. Agregá la primera.",
}: {
  fields: FormField[];
  onChange: (next: FormField[]) => void;
  disabled: boolean;
  neverPublished: boolean;
  /** El nombre de la lista para el lector de pantalla ("Preguntas de Instagram"). */
  label: string;
  emptyText?: string;
}) {
  const [raw, setSelection] = useState<BuilderSelection>(() => defaultEodSelection(fields));
  // Sin nada elegido (la lista estaba vacia y se copiaron preguntas de otro canal), se muestra la primera.
  const normalized = normalizeSelection(raw, fields);
  const selection = normalized.kind === "field" ? normalized : defaultEodSelection(fields);

  const builder = useBuilderActions({ fields, selection, neverPublished, onFields: onChange, onSelect: setSelection, adder: addEodField });

  const index = selectedIndex(selection, fields);
  const current = index >= 0 ? fields[index] : null;

  return (
    <section aria-label={label}>
      <BuilderLayout
        title={current ? `Pregunta · ${FIELD_TYPE_LABELS[current.type]}` : "Preguntas"}
        canvas={
          <FormCanvas
            mode="eod"
            formType="eod"
            fields={fields}
            selection={selection}
            onSelect={setSelection}
            actions={builder.actions}
            dropAt={builder.dropAt}
            onAdd={builder.add}
            disabled={disabled}
            addLabel="Agregar pregunta"
            emptyText={emptyText}
          />
        }
        panel={
          current ? (
            <InspectorField
              field={current}
              index={index}
              fields={fields}
              mode="eod"
              formType="eod"
              neverPublished={neverPublished}
              disabled={disabled}
              changeType={builder.changeType}
              patch={builder.patch}
              setKey={builder.setKey}
              actions={builder.actions}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Elegí una pregunta para editarla.</p>
          )
        }
      />
    </section>
  );
}
