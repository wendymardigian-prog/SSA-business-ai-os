"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, Globe, Loader2, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Notice, inputClass } from "@/components/agents/fields";
import { saveWebsiteOrigins } from "@/lib/actions/website-settings";
import { validateOrigin, MAX_ALLOWED_ORIGINS } from "@/lib/settings/website";
import { submitEndpoint, submitSnippet, unsubscribeLinkSnippet, type GuideForm } from "@/lib/settings/website-guide";

interface Row {
  origin: string;
  dev: boolean;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy(id: string, text: string) {
      void navigator.clipboard?.writeText(text).then(() => {
        setCopied(id);
        window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
      });
    },
  };
}

function CopyButton({ id, text, state, label = "Copiar" }: { id: string; text: string; state: ReturnType<typeof useCopy>; label?: string }) {
  const done = state.copied === id;
  return (
    <button type="button" onClick={() => state.copy(id, text)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {done ? "Copiado" : label}
    </button>
  );
}

function CodeBlock({ id, code, state }: { id: string; code: string; state: ReturnType<typeof useCopy> }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 pr-24 text-xs leading-relaxed"><code>{code}</code></pre>
      <div className="absolute right-2 top-2">
        <CopyButton id={id} text={code} state={state} />
      </div>
    </div>
  );
}

/**
 * Ajustes → Integraciones → Tu sitio web: los orígenes permitidos (CORS) y la guía viva para
 * conectar la web del negocio, con sus datos reales. Quien no tiene `integrations.manage` ve la
 * lista sin poder cambiarla.
 */
export function WebsiteScreen({
  initialOrigins,
  canEdit,
  appUrl,
  workspaceSlug,
  forms,
}: {
  initialOrigins: Row[];
  canEdit: boolean;
  appUrl: string;
  workspaceSlug: string;
  forms: GuideForm[];
}) {
  const [saved, setSaved] = useState<Row[]>(initialOrigins);
  const [rows, setRows] = useState<Row[]>(initialOrigins);
  const [draft, setDraft] = useState("");
  const [draftDev, setDraftDev] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const copy = useCopy();
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  function add() {
    const checked = validateOrigin(draft, draftDev);
    if (!checked.ok) {
      setDraftError(checked.error);
      return;
    }
    if (rows.some((r) => r.origin === checked.origin)) {
      setDraftError("Esta dirección ya está en la lista");
      return;
    }
    if (rows.length >= MAX_ALLOWED_ORIGINS) {
      setDraftError(`Podés cargar hasta ${MAX_ALLOWED_ORIGINS} direcciones`);
      return;
    }
    setRows([...rows, { origin: checked.origin, dev: draftDev }]);
    setDraft("");
    setDraftDev(false);
    setDraftError(null);
    setMessage(null);
  }

  function remove(index: number) {
    setRows(rows.filter((_, i) => i !== index));
    setRowErrors({});
    setMessage(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveWebsiteOrigins(rows);
      if (result.ok) {
        setSaved(result.origins);
        setRows(result.origins);
        setRowErrors({});
        setMessage({ tone: "success", text: "Guardado. Los cambios valen desde ya." });
      } else {
        setRowErrors(result.errors ?? {});
        setMessage({ tone: "error", text: result.error });
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Tu sitio web"
        tooltip="Las direcciones desde las que tu web puede mandar formularios a este sistema. Cualquier otra queda bloqueada."
        backHref={
          <Link href="/dashboard/settings/integrations" className="mr-1 text-sm text-muted-foreground hover:text-foreground" aria-label="Volver a Integraciones">
            ←
          </Link>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <section aria-labelledby="origins-title" className="rounded-xl border border-border bg-card p-4">
            <h2 id="origins-title" className="text-sm font-semibold">Direcciones permitidas</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Solo desde estas direcciones exactas tu web puede mandar formularios y pedir links de baja. Escribí el dominio con <code>https://</code>, sin ruta: <code>https://tusitio.com</code>. Si tu web también responde con <code>www</code>, cargá las dos.
            </p>

            {rows.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Todavía no hay ninguna. Sin direcciones, solo funcionan los formularios de este sistema (su link y el código para embeber).
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
                {rows.map((row, index) => (
                  <li key={row.origin} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <code className="min-w-0 flex-1 truncate text-sm">{row.origin}</code>
                    {row.dev && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">De desarrollo</span>}
                    {canEdit && (
                      <button type="button" onClick={() => remove(index)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Quitar ${row.origin}`}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                    {rowErrors[index] && <p className="w-full text-xs text-red-600 dark:text-red-400">{rowErrors[index]}</p>}
                  </li>
                ))}
              </ul>
            )}

            {canEdit && (
              <div className="mt-4 flex flex-col gap-2">
                <label htmlFor="new-origin" className="text-sm font-medium">Agregar una dirección</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="new-origin"
                    className={`${inputClass} min-w-[14rem] flex-1`}
                    placeholder={draftDev ? "http://localhost:4321" : "https://tusitio.com"}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setDraftError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        add();
                      }
                    }}
                    aria-invalid={draftError ? true : undefined}
                    aria-describedby={draftError ? "new-origin-error" : undefined}
                  />
                  <button type="button" onClick={add} className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                    <Plus className="h-4 w-4" aria-hidden /> Agregar
                  </button>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={draftDev} onChange={(e) => setDraftDev(e.target.checked)} />
                  De desarrollo (para probar la web en tu compu: <code>http://localhost:&lt;puerto&gt;</code>)
                </label>
                {draftError && (
                  <p id="new-origin-error" className="text-xs text-red-600 dark:text-red-400">{draftError}</p>
                )}
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={save}
                    disabled={!dirty || pending}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Guardar cambios
                  </button>
                  {dirty && !pending && <span className="text-xs text-muted-foreground">Hay cambios sin guardar.</span>}
                </div>
              </div>
            )}
            {message && (
              <div className="mt-3">
                <Notice tone={message.tone}>{message.text}</Notice>
              </div>
            )}
          </section>

          <section aria-labelledby="guide-title" className="rounded-xl border border-border bg-card p-4">
            <h2 id="guide-title" className="text-sm font-semibold">Cómo conectar tu web</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tu web manda cada formulario con un <code>fetch</code> desde el navegador. Estos son los datos de este negocio; pasáselos a quien arma la web (o a Claude Code, con <code>/conectar-web</code>).
            </p>

            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Dirección de este sistema</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs">{appUrl}</code>
                  <CopyButton id="app" text={appUrl} state={copy} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Identificador de este negocio (para el link de baja)</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs">{workspaceSlug}</code>
                  <CopyButton id="ws" text={workspaceSlug} state={copy} />
                </dd>
              </div>
            </dl>

            <h3 className="mt-6 text-sm font-semibold">Formularios publicados</h3>
            {forms.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Todavía no hay formularios publicados. Creá uno en <Link href="/dashboard/formularios" className="underline">Formularios</Link>: cada pregunta tiene una <em>clave</em> (key) que es el nombre que usa la web.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-4">
                {forms.map((form) => (
                  <details key={form.slug} className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      {form.name} <span className="font-normal text-muted-foreground">· {form.slug}</span>
                    </summary>
                    <div className="mt-3 flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs">{submitEndpoint(appUrl, form.slug)}</code>
                        <CopyButton id={`url-${form.slug}`} text={submitEndpoint(appUrl, form.slug)} state={copy} />
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-left text-muted-foreground">
                            <tr>
                              <th scope="col" className="py-1 pr-3 font-medium">Clave (key)</th>
                              <th scope="col" className="py-1 pr-3 font-medium">Pregunta</th>
                              <th scope="col" className="py-1 pr-3 font-medium">Tipo</th>
                              <th scope="col" className="py-1 font-medium">Obligatoria</th>
                            </tr>
                          </thead>
                          <tbody>
                            {form.fields.map((f) => (
                              <tr key={f.key} className="border-t border-border">
                                <td className="py-1 pr-3"><code>{f.key}</code></td>
                                <td className="py-1 pr-3">{f.label}</td>
                                <td className="py-1 pr-3">{f.type}</td>
                                <td className="py-1">{f.required ? "Sí" : "No"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <CodeBlock id={`code-${form.slug}`} code={submitSnippet(appUrl, form)} state={copy} />
                    </div>
                  </details>
                ))}
              </div>
            )}

            <h3 className="mt-6 text-sm font-semibold">Link de baja nuevo</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Para una página de baja en tu web: la persona escribe su email y, si está en tus contactos, le llega un email con su link para darse de baja. Responde siempre lo mismo, exista o no el email.
            </p>
            <div className="mt-2">
              <CodeBlock id="unsub" code={unsubscribeLinkSnippet(appUrl, workspaceSlug)} state={copy} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
