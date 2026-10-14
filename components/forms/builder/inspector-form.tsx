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
  onOpenContact,
}: {
  name: string;
  onName: (name: string) => void;
  design: FormDesign;
  onDesign: (next: FormDesign) => void;
  fields: FormField[];
  contactConfig: ContactConfig;
  disabled: boolean;
  onOpenContact?: () => void;
}) {
  const summary = builderSummary(fields, contactConfig);
  return (
    <div className="space-y-4">
      <Field label="Nombre interno" hint="Solo lo ve tu equipo, en la lista de formularios y en los reportes.">
        {(id) => <input id={id} className={inputClass} disabled={disabled} value={name} maxLength={120} onChange={(e) => onName(e.target.value)} />}
      </Field>
      <Field label="Título público" hint="Es el encabezado que ve quien responde. Puede ser distinto del nombre interno.">
        {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={200} value={design.title} onChange={(e) => onDesign({ ...design, title: e.target.value })} />}
      </Field>
      <Field label="Introducción" hint="Aparece debajo del título. Los saltos de línea se respetan.">
        {(id) => <textarea id={id} rows={3} className={inputClass} disabled={disabled} maxLength={2000} value={design.intro} onChange={(e) => onDesign({ ...design, intro: e.target.value })} />}
      </Field>
      <Field label="Texto del botón" hint="Vacío: “Enviar” (“Firmar y enviar” en un contrato).">
        {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={60} value={design.submitLabel} onChange={(e) => onDesign({ ...design, submitLabel: e.target.value })} />}
      </Field>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Resumen</p>
        <dl className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
          <SummaryItem label="preguntas" value={summary.questions} />
          <SummaryItem label="obligatorias" value={summary.required} />
          <SummaryItem label="condicionales" value={summary.conditional} />
        </dl>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {summary.toContact} {summary.toContact === 1 ? "va" : "van"} al contacto
          {onOpenContact && (
            <>
              {" · "}
              <button type="button" onClick={onOpenContact} className="text-primary underline hover:no-underline">
                ver el mapeo
              </button>
            </>
          )}
        </p>
      </div>

      <div>
        <p className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Atribución
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">Automática</span>
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">Cada respuesta guarda sola todos los parámetros con los que llegó la persona. No tenés que agregar campos ocultos.</p>
        <p className="mt-2 text-[11px] text-muted-foreground">UTM</p>
        <p className="mt-1 flex flex-wrap gap-1">
          {["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"].map((k) => (
            <code key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10.5px]">
              {k}
            </code>
          ))}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">Anuncio de Meta</p>
        <p className="mt-1 flex flex-wrap gap-1">
          {["ad_id", "adset_id", "campaign_id", "placement"].map((k) => (
            <code key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10.5px]">
              {k}
            </code>
          ))}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">y los ids de clic de Google, TikTok y otras plataformas, las cookies de Meta y Google, la página de llegada y el referrer.</p>
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Y la URL de entrada completa:</span> la dirección por la que entró la persona, con todos los parámetros que traía (también <code className="text-[10.5px]">ad_name</code>, <code className="text-[10.5px]">campaign_name</code> o un <code className="text-[10.5px]">?ref=podcast</code> propio).
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground">Tocá una pregunta del formulario para configurarla.</p>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse rounded-lg border border-border px-2 py-1.5">
      <dt className="mt-1 text-[10.5px] text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold leading-none">{value}</dd>
    </div>
  );
}
