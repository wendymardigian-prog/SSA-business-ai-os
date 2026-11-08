"use client";

/**
 * Modal «Emitir <tipo>» / «Generar para…» de una plantilla (F50).
 *
 * Para quién (buscador de contactos), las variables con su valor (las propias se completan; las del sistema se pueden
 * cambiar solo para esta pieza), la vista previa con los datos reales, «Publicar con link» y «Mandar por email». Escritorio:
 * dos columnas (datos y vista previa). Celular: pantalla completa, los datos arriba y la vista previa que se abre con un
 * botón. El título, el botón y el aviso «Ya tiene un/a <tipo> válido/a…» salen del tipo de documento de la plantilla
 * (`verification.ts`); lo que se puede confirmar, y por qué no, lo decide `lib/designer/screens/generate-one.ts`.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { DesignerDialog, inputClass, primaryButton, secondaryButton } from "@/components/designer/editor/overlays";
import { useUrlParam } from "@/components/designer/editor/use-url-param";
import { generateOne, previewGeneration } from "@/lib/actions/designer/generate";
import { loadGenerateContext, searchGenerateContacts } from "@/lib/actions/designer/generations";
import type { GenerateModalProps, GenerationPreview } from "@/lib/designer/contracts";
import type { ContactChoice, GenerateContext } from "@/lib/designer/generations-query";
import { alreadyValidNotice } from "@/lib/designer/verification";
import { buildGenerateOneInput, busyLabel, initialEmail, missingRows, previewValues, submitReason, variableRows } from "@/lib/designer/screens/generate-one";
import { cn } from "@/lib/utils";
import { EmailFields } from "./email-fields";
import { notifyGenerationsChanged } from "./events";
import { PiecePreview } from "./piece-preview";

export function GenerateOneModal({ templateId, open, onClose }: GenerateModalProps) {
  if (!open) return null;
  return <GenerateOneDialog templateId={templateId} onClose={onClose} />;
}

function GenerateOneDialog({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const router = useRouter();
  const [, setTab] = useUrlParam("tab");
  const [ctx, setCtx] = useState<GenerateContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [contact, setContact] = useState<ContactChoice | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactChoice[]>([]);
  const [searching, setSearching] = useState(false);

  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<GenerationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [publish, setPublish] = useState(true);
  const [emailOn, setEmailOn] = useState(false);
  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string } | null>(null);
  const [replace, setReplace] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La plantilla (su documento, sus variables, el texto del botón).
  useEffect(() => {
    let alive = true;
    loadGenerateContext({ templateId })
      .then((res) => {
        if (!alive) return;
        if (res.ok) setCtx(res.data);
        else setLoadError(res.error);
      })
      .catch(() => alive && setLoadError("No pudimos abrir la plantilla. Probá de nuevo."));
    return () => {
      alive = false;
    };
  }, [templateId]);

  // El buscador de «Para».
  useEffect(() => {
    if (contact || query.trim().length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchGenerateContacts({ query })
        .then((res) => alive && setResults(res.ok ? res.data : []))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setSearching(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, contact]);

  // La vista previa: los valores reales del contacto elegido, con lo puesto a mano.
  const typed = useMemo(() => Object.fromEntries(Object.entries(overrides).filter(([, v]) => v.trim() !== "")), [overrides]);
  const typedKey = JSON.stringify(typed);
  const contactId = contact?.id ?? null;
  useEffect(() => {
    if (!contactId) return;
    let alive = true;
    const timer = setTimeout(() => {
      previewGeneration({ templateId, contactId, overrides: JSON.parse(typedKey) as Record<string, string> })
        .then((res) => {
          if (!alive) return;
          if (res.ok) {
            setPreview(res.data);
            setPreviewError(null);
          } else setPreviewError(res.error);
        })
        .catch(() => alive && setPreviewError("No pudimos preparar la vista previa."));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [templateId, contactId, typedKey]);

  const livePreview = contactId ? preview : null;
  const rows = useMemo(
    () => (ctx ? variableRows({ usedKeys: ctx.usedKeys, customVars: ctx.template.customVars, values: livePreview?.values ?? {}, missingKeys: livePreview?.missing.map((m) => m.key) ?? [], overrides }) : []),
    [ctx, livePreview, overrides],
  );
  const shownValues = useMemo(() => previewValues(rows, livePreview?.values ?? {}, overrides), [rows, livePreview, overrides]);

  if (loadError || !ctx) {
    return (
      <DesignerDialog title="Generar para…" label="Generar para…" onClose={onClose} footer={<button type="button" className={secondaryButton} onClick={onClose}>Cerrar</button>}>
        {loadError ? <p role="alert" className="text-sm text-bad">{loadError}</p> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Cargando la plantilla…</p>}
      </DesignerDialog>
    );
  }

  const { template } = ctx;
  const email = emailDraft ?? initialEmail(template.noun);
  const existing = livePreview?.existingValid ?? null;
  const contactHasEmail = livePreview ? livePreview.values["contact.email"]?.trim() !== "" : null;
  const state = { contactId, rows, publish, emailOn, email, contactHasEmail, existing: existing ? { code: existing.code } : null, replace };
  const reason = submitReason(state, { doc_type: template.docType, doc_type_label: template.docTypeLabel });
  const missing = missingRows(rows);

  async function submit() {
    if (reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await generateOne(buildGenerateOneInput(templateId, state, typed));
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
      onClose();
      setTab("generaciones");
      notifyGenerationsChanged();
      router.refresh();
    } catch {
      setError("No pudimos generar la pieza. Probá de nuevo.");
      setBusy(false);
    }
  }

  return (
    <DesignerDialog
      wide
      title={template.issueLabel}
      label={`${template.issueLabel} · ${template.name}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          {(reason || error) && (
            <p role={error ? "alert" : undefined} className={cn("mr-auto min-w-0 flex-1 text-xs", error ? "text-bad" : "text-muted-foreground")}>
              {error ?? reason}
            </p>
          )}
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className={primaryButton} onClick={submit} disabled={!!reason || busy} title={reason ?? undefined}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? busyLabel(template.issueLabel) : template.issueLabel}
          </button>
        </>
      }
    >
      <p className="-mt-1 text-xs text-muted-foreground">{template.name}</p>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {/* Para */}
          <section aria-labelledby="gen-para" className="space-y-1.5">
            <h3 id="gen-para" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Para
            </h3>
            {contact ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{contact.name}</p>
                  {contact.detail && <p className="truncate text-xs text-muted-foreground">{contact.detail}</p>}
                </div>
                <button
                  type="button"
                  aria-label="Elegir a otra persona"
                  onClick={() => {
                    setContact(null);
                    setPreview(null);
                    setReplace(false);
                    setQuery("");
                    setResults([]);
                  }}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : (
              <div className="relative">
                <label className="relative block">
                  <span className="sr-only">Buscar un contacto</span>
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscá por nombre, email o teléfono…" className={cn(inputClass, "pl-8")} autoComplete="off" />
                </label>
                {query.trim().length >= 2 && (
                  <ul aria-label="Contactos encontrados" className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-card">
                    {searching && results.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">Buscando…</li>}
                    {!searching && results.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No encontramos a nadie con eso.</li>}
                    {results.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setContact(c);
                            setQuery("");
                            setResults([]);
                          }}
                          className="block w-full px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                        >
                          <span className="block truncate text-sm font-medium">{c.name}</span>
                          {c.detail && <span className="block truncate text-xs text-muted-foreground">{c.detail}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {/* Aviso: ya tiene una válida */}
          {existing && (
            <div role="status" className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
              <p>{alreadyValidNotice({ doc_type: template.docType, doc_type_label: template.docTypeLabel }, existing.code)}</p>
              <div className="flex items-center gap-2">
                <Switch checked={replace} onChange={setReplace} label="Reemplazar la anterior (se anula)" />
                <span className="text-xs text-muted-foreground">Reemplazarla: la anterior queda anulada y esta toma su lugar.</span>
              </div>
            </div>
          )}

          {/* Variables */}
          <section aria-labelledby="gen-vars" className="space-y-2">
            <h3 id="gen-vars" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Datos de la pieza
            </h3>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Esta plantilla no usa variables: sale igual para todos.</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => {
                  const open = row.kind === "own" || editing[row.key] || (row.required && row.empty && !!contact);
                  return (
                    <li key={row.key} className="space-y-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <label htmlFor={`gen-var-${row.key}`} className="text-sm font-medium">
                          {row.label}
                          {row.required && <span className="text-bad" aria-label="obligatorio"> *</span>}
                        </label>
                        {row.kind === "system" && !open && (
                          <button type="button" className="text-xs text-primary-ink underline-offset-2 hover:underline" onClick={() => setEditing((e) => ({ ...e, [row.key]: true }))}>
                            Cambiar solo para esta pieza
                          </button>
                        )}
                      </div>
                      {row.kind === "code" ? (
                        <p className="text-sm text-muted-foreground">{row.value}</p>
                      ) : open ? (
                        <input
                          id={`gen-var-${row.key}`}
                          className={inputClass}
                          value={overrides[row.key] ?? (row.kind === "own" ? "" : row.value)}
                          placeholder={row.kind === "own" ? (template.customVars.find((v) => v.key === row.key)?.sample ?? "") : ""}
                          onChange={(e) => setOverrides((o) => ({ ...o, [row.key]: e.target.value }))}
                          aria-invalid={row.required && row.empty}
                        />
                      ) : (
                        <p id={`gen-var-${row.key}`} className={cn("text-sm", row.empty ? "text-muted-foreground" : "")}>
                          {row.value || (contact ? "—" : "Se completa con el contacto")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {missing.length > 0 && contact && <p className="text-xs text-bad">Falta completar lo marcado con *.</p>}
            {previewError && <p role="alert" className="text-xs text-bad">{previewError}</p>}
          </section>

          {/* Publicar y email */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Switch checked={publish} onChange={setPublish} label="Publicar con link" />
              <span>Publicar con link</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Switch checked={emailOn} onChange={setEmailOn} label="Mandar por email" disabled={contactHasEmail === false} />
                <span>Mandar por email</span>
                {contactHasEmail === false && <span className="text-xs text-muted-foreground">(este contacto no tiene email)</span>}
              </div>
              {emailOn && contactHasEmail !== false && <EmailFields subject={email.subject} body={email.body} onChange={setEmailDraft} />}
            </div>
          </section>
        </div>

        {/* Vista previa */}
        <div className="min-w-0">
          <button type="button" className={cn(secondaryButton, "mb-3 w-full lg:hidden")} aria-expanded={showPreview} onClick={() => setShowPreview((s) => !s)}>
            {showPreview ? "Ocultar la vista previa" : "Ver la vista previa"}
          </button>
          <div className={cn(showPreview ? "block" : "hidden", "lg:block")}>
            <PiecePreview doc={template.doc} values={shownValues} assetUrls={ctx.assetUrls} uploadedFonts={ctx.uploadedFonts} label={`Vista previa de ${template.name}`} />
            {!contact && <p className="mt-2 text-center text-xs text-muted-foreground">Elegí a quién va para ver la pieza con sus datos.</p>}
          </div>
        </div>
      </div>
    </DesignerDialog>
  );
}
