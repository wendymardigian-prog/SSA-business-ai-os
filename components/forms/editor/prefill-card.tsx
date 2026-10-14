"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Notice, inputClass } from "@/components/agents/fields";
import { CONTACT_LINK_VARIABLES, buildPrefillLink, describePrefillParams } from "@/lib/forms/prefill";
import type { FormDefinition } from "@/lib/forms/fields";

/**
 * El armador de links con datos ya cargados (F32; plano formularios-ui, F14: vive en la tarjeta "Link para un
 * contacto" de Publicar). Los parametros de cada pregunta se configuran en su panel ("Llenar desde la URL"); aca
 * solo se les pone un valor y se arma una URL lista para copiar. Las variables del contacto van sin codificar, para
 * pegar el link en un mensaje o email de un flow (las resuelve el nodo de envio).
 */
export function PrefillLinkBuilder({ definition, baseUrl, slug }: { definition: FormDefinition; baseUrl: string; slug?: string }) {
  const described = useMemo(() => describePrefillParams(definition), [definition]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const link = buildPrefillLink(baseUrl, values);
  const usesContactVariables = Object.values(values).some((v) => /\{\{\s*contact\./i.test(v));
  const rows = [
    ...described.fields.map((f) => ({ key: f.fieldKey, label: f.label, param: f.params[0], accepts: f.params })),
    ...described.hidden.filter((h) => h.source === "url_param").map((h) => ({ key: h.fieldKey, label: h.label, param: h.param, accepts: [h.param] })),
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
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold">Link con datos ya cargados</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Mandá un link que ya traiga datos escritos. Cada pregunta define su parámetro en su panel, en “Llenar desde la URL”.</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguna pregunta se puede prellenar desde la URL. Las de consentimiento y archivos nunca se prellenan.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Pregunta</th>
                  <th scope="col" className="px-3 py-2 font-medium">Parámetro</th>
                  <th scope="col" className="px-3 py-2 font-medium">Valor para el link</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-border">
                    <td className="px-3 py-2">{row.label}</td>
                    <td className="px-3 py-2 font-mono font-semibold">{row.accepts.join(" · ")}</td>
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
    </div>
  );
}
