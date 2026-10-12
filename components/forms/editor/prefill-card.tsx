"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Notice, inputClass } from "@/components/agents/fields";
import { AUTO_ATTRIBUTION_GROUPS, CONTACT_LINK_VARIABLES, buildPrefillLink, describePrefillParams } from "@/lib/forms/prefill";
import type { FormDefinition, PrefillBehavior } from "@/lib/forms/fields";

const BEHAVIOR_LABELS: Record<PrefillBehavior, string> = {
  editable: "Editable",
  locked: "Bloqueado",
  hidden: "Se oculta si viene lleno",
};

/**
 * Los parámetros de la URL del formulario y un armador de links con prellenado (F32).
 * La tabla sale de la definición del borrador; el armador junta los valores en una URL
 * lista para copiar. Las variables del contacto van sin codificar, para pegar el link en
 * un mensaje o email de una automatización (las resuelve el nodo de envío).
 */
export function PrefillCard({ definition, baseUrl, slug }: { definition: FormDefinition; baseUrl: string; slug?: string }) {
  const described = useMemo(() => describePrefillParams(definition), [definition]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const link = buildPrefillLink(baseUrl, values);
  const usesContactVariables = Object.values(values).some((v) => /\{\{\s*contact\./i.test(v));
  const rows = [
    ...described.fields.map((f) => ({ key: f.fieldKey, label: f.label, param: f.params[0], note: BEHAVIOR_LABELS[f.behavior], accepts: f.params, example: f.example })),
    ...described.hidden.filter((h) => h.source === "url_param").map((h) => ({ key: h.fieldKey, label: h.label, param: h.param, note: "Campo oculto", accepts: [h.param], example: "valor" })),
  ];
  // El link firmado por contacto: lo identifica sin poner sus datos en la URL.
  const signedToken = slug ? `{{form_link.${slug.replace(/-/g, "_")}}}` : "{{form_link.<link>}}";

  function copy() {
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-labelledby="parametros-url">
      <div>
        <h2 id="parametros-url" className="text-sm font-semibold">
          Parámetros de la URL
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">Podés mandar un link que ya traiga datos escritos. Estos son los parámetros que acepta este formulario.</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ningún campo se puede prellenar desde la URL. Los de consentimiento y archivos nunca se prellenan.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Campo</th>
                  <th scope="col" className="px-3 py-2 font-medium">Parámetro</th>
                  <th scope="col" className="px-3 py-2 font-medium">Ejemplo de link</th>
                  <th scope="col" className="px-3 py-2 font-medium">Comportamiento</th>
                  <th scope="col" className="px-3 py-2 font-medium">Valor para el link</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-border">
                    <td className="px-3 py-2">{row.label}</td>
                    <td className="px-3 py-2 font-mono font-semibold">{row.accepts.join(" · ")}</td>
                    <td className="px-3 py-2">
                      <code className="break-all rounded bg-muted px-1.5 py-0.5 text-[11px]">{buildPrefillLink(baseUrl, { [row.param]: row.example })}</code>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.note}</td>
                    <td className="px-3 py-2">
                      <input
                        aria-label={`Valor de ${row.label} para el link`}
                        className={`${inputClass} h-8 text-xs`}
                        value={values[row.param] ?? ""}
                        onChange={(e) => setValues({ ...values, [row.param]: e.target.value })}
                        placeholder="vacío = sin prellenar"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Variables del contacto para un mensaje o email (van sin codificar y las reemplaza el envío):{" "}
              {CONTACT_LINK_VARIABLES.map((variable) => (
                <code key={variable} className="mr-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  {variable}
                </code>
              ))}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-3 py-2 text-xs">{link}</code>
              <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {copied ? "Copiado" : "Copiar link"}
              </button>
            </div>
            {usesContactVariables && (
              <Notice tone="info">
                Los datos del contacto viajan en la URL. Para mandarle el link a un contacto que ya existe es mejor el link firmado (<code className="rounded bg-muted px-1 text-[11px]">{signedToken}</code> en un mensaje, o “Link para un contacto” arriba): lo identifica sin poner sus datos en la URL. Para una encuesta de “una vez por contacto” es el que corresponde.
              </Notice>
            )}
          </div>
        </>
      )}

      <details className="rounded-lg border border-border p-3 text-xs">
        <summary className="cursor-pointer font-medium">Lo que se registra solo (no tenés que hacer nada)</summary>
        <ul className="mt-2 space-y-1.5 text-muted-foreground">
          {AUTO_ATTRIBUTION_GROUPS.map((group) => (
            <li key={group.title}>
              <span className="font-medium text-foreground">{group.title}: </span>
              <span className="font-mono">{group.keys.join(", ")}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
