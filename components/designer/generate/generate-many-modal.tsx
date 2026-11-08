"use client";

/**
 * Modal «Generar para varios…» de una plantilla (F51).
 *
 * Se eligen los contactos con los MISMOS filtros que ya tiene Contactos (etiqueta, segmento, búsqueda…): «23 cumplen · 4 ya
 * tienen uno válido (se saltean)». Se puede publicar con link y mandar el email a cada uno. Al confirmar se encola la tanda
 * (hasta 500) y cada pieza aparece «En proceso» en Generaciones. Lo que se dice y cuándo se puede confirmar sale de
 * `lib/designer/screens/generate-many.ts`.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { ActiveFilterChips } from "@/components/contacts/active-filter-chips";
import { ContactFiltersPanel } from "@/components/contacts/filters-panel";
import { Switch } from "@/components/ui/switch";
import { DesignerDialog, inputClass, primaryButton, secondaryButton } from "@/components/designer/editor/overlays";
import { useUrlParam } from "@/components/designer/editor/use-url-param";
import { countGenerationAudience, generateMany } from "@/lib/actions/designer/generate";
import { loadGenerateManyContext } from "@/lib/actions/designer/generations";
import type { GenerateModalProps } from "@/lib/designer/contracts";
import { CONTACT_FILTERS } from "@/lib/contacts/list-modules";
import { CUSTOM_FILTER_PARAMS, countMenuFilters, customFilterRawValue, parseContactListFilters } from "@/lib/contacts/list-query";
import { firstParam } from "@/lib/url-params";
import { initialEmail } from "@/lib/designer/screens/generate-one";
import { buildGenerateManyInput, countLine, manyPrimaryLabel, manyReason, paramsToQuery, skipLabel, type ManyCounts } from "@/lib/designer/screens/generate-many";
import { cn } from "@/lib/utils";
import { EmailFields } from "./email-fields";
import { notifyGenerationsChanged } from "./events";

type Params = Record<string, string | string[]>;
type Loaded = Awaited<ReturnType<typeof loadGenerateManyContext>> & { ok: true };

export function GenerateManyModal({ templateId, open, onClose }: GenerateModalProps) {
  if (!open) return null;
  return <GenerateManyDialog templateId={templateId} onClose={onClose} />;
}

function GenerateManyDialog({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const router = useRouter();
  const [, setTab] = useUrlParam("tab");
  const [ctx, setCtx] = useState<Loaded["data"] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [params, setParams] = useState<Params>({});
  const [skipExisting, setSkipExisting] = useState<boolean | null>(null);
  const [publish, setPublish] = useState(true);
  const [emailOn, setEmailOn] = useState(false);
  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string } | null>(null);
  const [counted, setCounted] = useState<{ key: string; counts: ManyCounts | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadGenerateManyContext({ templateId })
      .then((res) => {
        if (!alive) return;
        if (res.ok) setCtx(res.data);
        else setLoadError(res.error);
      })
      .catch(() => alive && setLoadError("No pudimos abrir los filtros. Probá de nuevo."));
    return () => {
      alive = false;
    };
  }, [templateId]);

  // «Saltear a quienes ya tienen uno válido» arranca prendida si la plantilla verifica (una sola válida por persona).
  const skip = skipExisting ?? ctx?.template.verify ?? false;
  const query = paramsToQuery(params);
  const countKey = JSON.stringify([query, skip]);

  // A cuántos les toca: el conteo vale para los filtros y la casilla con los que se pidió.
  useEffect(() => {
    if (!ctx) return;
    let alive = true;
    const timer = setTimeout(() => {
      countGenerationAudience({ templateId, audienceParams: query, skipExisting: skip })
        .then((res) => alive && setCounted({ key: countKey, counts: res.ok ? res.data : null, error: res.ok ? null : res.error }))
        .catch(() => alive && setCounted({ key: countKey, counts: null, error: "No pudimos contar a quiénes les toca. Probá de nuevo." }));
    }, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ctx, templateId, query, skip, countKey]);

  const search = firstParam(params.q);
  const filters = useMemo(() => (ctx ? parseContactListFilters(params, ctx.filters.customFields, search) : null), [ctx, params, search]);

  if (loadError || !ctx || !filters) {
    return (
      <DesignerDialog title="Generar para varios…" label="Generar para varios" onClose={onClose} footer={<button type="button" className={secondaryButton} onClick={onClose}>Cerrar</button>}>
        {loadError ? <p role="alert" className="text-sm text-bad">{loadError}</p> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Cargando…</p>}
      </DesignerDialog>
    );
  }

  const { template } = ctx;
  const fresh = counted?.key === countKey;
  const counts = counted?.counts ?? null;
  const email = emailDraft ?? initialEmail(template.noun);
  const state = { counts, skipExisting: skip, publish, emailOn, email };
  const reason = counted?.error && fresh ? counted.error : manyReason(state);

  function setList(param: string, values: readonly string[]) {
    setParams((prev) => {
      const next = { ...prev };
      if (values.length === 0) delete next[param];
      else next[param] = values.length === 1 ? values[0] : [...values];
      return next;
    });
  }
  function setMany(patch: Record<string, string>) {
    setParams((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v) next[k] = v;
        else delete next[k];
      }
      return next;
    });
  }
  function clearFilters() {
    setParams((prev): Params => (prev.q ? { q: prev.q } : {}));
  }

  async function submit() {
    if (reason || !fresh || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await generateMany(buildGenerateManyInput(templateId, params, state));
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
      setError("No pudimos preparar la tanda. Probá de nuevo.");
      setBusy(false);
    }
  }

  return (
    <DesignerDialog
      title="Generar para varios…"
      label={`Generar para varios · ${template.name}`}
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
          <button type="button" className={primaryButton} onClick={submit} disabled={!!reason || !fresh || busy} title={reason ?? undefined}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {manyPrimaryLabel(counts, skip)}
          </button>
        </>
      }
    >
      <p className="-mt-1 text-xs text-muted-foreground">{template.name}</p>

      <section aria-labelledby="many-who" className="space-y-2">
        <h3 id="many-who" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          A quiénes
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Buscar contactos</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input type="search" value={search} onChange={(e) => setMany({ q: e.target.value.slice(0, 100) })} placeholder="Nombre, email, teléfono, @usuario…" className={cn(inputClass, "pl-8")} />
          </label>
          <ContactFiltersPanel
            defs={CONTACT_FILTERS}
            filters={filters}
            options={ctx.filters.options}
            customFields={ctx.filters.customFields}
            customFilter={filters.custom ? { slug: filters.custom.field.slug, op: filters.custom.op, value: customFilterRawValue(params) } : null}
            hidden={ctx.filters.hasAnonymous ? undefined : new Set(["anon"])}
            activeCount={countMenuFilters(filters)}
            onList={setList}
            onParams={setMany}
            onClear={clearFilters}
          />
        </div>
        <div className="[&>div]:border-b-0 [&>div]:px-0 [&>div]:py-0 md:[&>div]:px-0">
          <ActiveFilterChips
            defs={CONTACT_FILTERS}
            filters={filters}
            options={ctx.filters.options}
            onRemove={(param) => setList(param, [])}
            onRemoveCustom={() => setMany(Object.fromEntries(CUSTOM_FILTER_PARAMS.map((p) => [p, ""])))}
            onClear={clearFilters}
          />
        </div>
        {countMenuFilters(filters) === 0 && !search && <p className="text-xs text-muted-foreground">Sin filtros, son todos los contactos (sin los que todavía no dejaron ningún dato).</p>}

        <div aria-live="polite" className={cn("rounded-lg border border-border bg-card px-3 py-2 text-sm", !fresh && "opacity-60")}>
          {counts ? <span className="font-medium">{countLine(counts, skip)}</span> : <span className="text-muted-foreground">{counted?.error && fresh ? counted.error : "Contando…"}</span>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Switch checked={skip} onChange={setSkipExisting} label={skipLabel({ doc_type: template.docType, doc_type_label: template.docTypeLabel })} />
          <span>{skipLabel({ doc_type: template.docType, doc_type_label: template.docTypeLabel })}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Switch checked={publish} onChange={setPublish} label="Publicar con link" />
          <span>Publicar con link</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Switch checked={emailOn} onChange={setEmailOn} label="Mandar por email" />
            <span>Mandar el email con el link a cada uno</span>
          </div>
          {emailOn && <EmailFields subject={email.subject} body={email.body} onChange={setEmailDraft} />}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">Se generan en segundo plano. Las ves en Generaciones; si alguna falla, se reintenta desde ahí. Máximo 500 por vez.</p>
    </DesignerDialog>
  );
}
