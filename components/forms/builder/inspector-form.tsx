"use client";

import { Field, inputClass } from "@/components/agents/fields";
import { builderSummary } from "@/lib/forms/builder-summary";
import type { ContactConfig } from "@/lib/forms/contact-config";
import type { FormDesign } from "@/lib/forms/defaults";
import type { FormField } from "@/lib/forms/fields";

/**
 * El panel del formulario entero (plano formularios-ui, F11): lo que se ve cuando no hay una pregunta elegida.
 * Nombre interno, lo que ve el publico (titulo, introduccion y texto del boton: los mismos que se escriben sobre el
 * lienzo), un resumen y una nota sobre la atribucion, que ya no se configura.
 */
export function InspectorForm({
  name,
  onName,
  design,
  onDesign,
  fields,
  contactConfig,
  disabled,
}: {
  name: string;
  onName: (name: string) => void;
  design: FormDesign;
  onDesign: (next: FormDesign) => void;
  fields: FormField[];
  contactConfig: ContactConfig;
  disabled: boolean;
}) {
  const summary = builderSummary(fields, contactConfig);
  return (
    <div className="space-y-4">
      <Field label="Nombre interno" hint="Solo lo ve tu equipo. Es el que aparece en la lista.">
        {(id) => <input id={id} className={inputClass} disabled={disabled} value={name} maxLength={120} onChange={(e) => onName(e.target.value)} />}
      </Field>
      <Field label="Título público" hint="Lo que lee quien responde, arriba del formulario.">
        {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={200} value={design.title} onChange={(e) => onDesign({ ...design, title: e.target.value })} />}
      </Field>
      <Field label="Introducción" hint="Aparece debajo del título. Los saltos de línea se respetan.">
        {(id) => <textarea id={id} rows={3} className={inputClass} disabled={disabled} maxLength={2000} value={design.intro} onChange={(e) => onDesign({ ...design, intro: e.target.value })} />}
      </Field>
      <Field label="Texto del botón" hint="Vacío: “Enviar” (“Firmar y enviar” en un contrato).">
        {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={60} value={design.submitLabel} onChange={(e) => onDesign({ ...design, submitLabel: e.target.value })} />}
      </Field>

      <dl className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 text-xs">
        <SummaryItem label="Preguntas" value={summary.questions} />
        <SummaryItem label="Obligatorias" value={summary.required} />
        <SummaryItem label="Condicionales" value={summary.conditional} />
        <SummaryItem label="Van al contacto" value={summary.toContact} />
      </dl>

      <div className="rounded-lg border border-border p-3 text-xs">
        <p className="font-semibold">Atribución · Automática</p>
        <p className="mt-1 text-muted-foreground">
          De dónde llegó cada persona (campaña, anuncio, la dirección completa por la que entró) se guarda sola en cada respuesta. No hace falta agregar preguntas ocultas para eso.
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground">Tocá una pregunta para configurarla. Tocá “Después de enviar” para cambiar lo que pasa cuando terminan.</p>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold">{value}</dd>
    </div>
  );
}
