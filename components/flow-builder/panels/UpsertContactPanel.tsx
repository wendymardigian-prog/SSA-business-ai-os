"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Trash2, Wand2 } from "lucide-react";
import type { Node } from "@xyflow/react";
import { JsonTree } from "@/components/webhooks/json-tree";
import { getUpsertEditorContext, testUpsertMapping } from "@/lib/actions/webhook-flow-editor";
import { FIXED_TARGETS, FIXED_TARGET_LABELS } from "@/lib/forms/contact-config";
import { detectAttribution, WEBHOOK_ATTRIBUTION_KEYS } from "@/lib/webhooks/attribution";
import { suggestMapRows } from "@/lib/webhooks/mapping";
import { DEFAULT_UPSERT_CONFIG, parseUpsertContactConfig, type MapRow, type MapSource, type Transform, type UpsertContactConfig } from "@/lib/webhooks/upsert-config";
import type { UpsertEditorContext, UpsertPreview } from "@/lib/webhooks/action-types";
import { parseWebhookTriggerConfig } from "@/lib/webhooks/trigger-config";

const inputClass = "w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const labelClass = "mb-1 block text-xs font-semibold text-foreground";

const TRANSFORMS: Array<{ value: Transform | ""; label: string }> = [
  { value: "", label: "Sin transformar" },
  { value: "clean_phone", label: "Limpiar teléfono" },
  { value: "lowercase", label: "Minúsculas" },
  { value: "trim", label: "Sin espacios" },
  { value: "split_name", label: "Separar nombre y apellido" },
];

const sourcePath = (s: MapSource): string => ("path" in s ? s.path : "");
const isConst = (s: MapSource): s is { const: string } => "const" in s;

/**
 * El panel del paso «Crear o actualizar contacto» (F12–F14): el modo, la política, el mapeo campo por
 * campo desde el ejemplo del webhook, los tags, la atribución y «Probar con el ejemplo» (no escribe nada).
 * Se guarda con zod al publicar el flujo.
 */
export function UpsertContactPanel({ data, nodes, onChange }: { data: Record<string, unknown>; nodes: Node[]; onChange: (data: Record<string, unknown>) => void }) {
  const config = useMemo(() => parseUpsertContactConfig(data), [data]);
  const triggerData = nodes.find((n) => n.type === "trigger")?.data as Record<string, unknown> | undefined;
  const endpointId = parseWebhookTriggerConfig(triggerData).endpointId;

  const [context, setContext] = useState<UpsertEditorContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picking, setPicking] = useState<number | "tags" | `attr:${number}` | null>(null);
  const [preview, setPreview] = useState<UpsertPreview | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    getUpsertEditorContext(endpointId).then((res) => {
      if (!alive) return;
      if (res.ok) setContext(res.context);
      else setLoadError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [endpointId]);

  /** Se guarda el nodo con lo que no es el valor por defecto: el JSON del flujo queda chico y legible. */
  const save = (next: UpsertContactConfig) => onChange({ ...data, ...next });
  const patch = (partial: Partial<UpsertContactConfig>) => save({ ...config, ...partial });
  const setRow = (index: number, row: MapRow) => patch({ map: config.map.map((r, i) => (i === index ? row : r)) });
  const sample = context?.sample ?? null;

  const targets = useMemo(
    () => [
      ...FIXED_TARGETS.map((t) => ({ value: t as string, label: FIXED_TARGET_LABELS[t], group: "Contacto" })),
      ...(context?.customFields ?? []).map((f) => ({ value: `contact.custom.${f.slug}`, label: f.name, group: "Campos personalizados" })),
    ],
    [context],
  );

  const detected = useMemo(() => (sample ? detectAttribution(sample.payload, sample.query) : {}), [sample]);

  function runTest() {
    setTestError(null);
    setPreview(null);
    start(async () => {
      const res = await testUpsertMapping({ endpointId, config });
      if (!res.ok) return setTestError(res.error);
      setPreview(res.preview);
    });
  }

  function pickInto(slot: number | "tags" | `attr:${number}`, path: string) {
    if (slot === "tags") patch({ tags: { ...config.tags, fromSource: { path } } });
    else if (typeof slot === "string") {
      const i = Number(slot.slice(5));
      patch({ attribution: { ...config.attribution, map: config.attribution.map.map((r, idx) => (idx === i ? { ...r, source: { path } } : r)) } });
    } else setRow(slot, { ...config.map[slot], source: { ...("path" in config.map[slot].source ? config.map[slot].source : {}), path } as MapSource });
    setPicking(null);
  }

  const picker = (slot: number | "tags" | `attr:${number}`) =>
    picking === slot && sample ? (
      <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-background p-2">
        <JsonTree value={sample.payload} onPick={(path) => pickInto(slot, path)} />
        {Object.keys(sample.query).length > 0 && (
          <>
            <p className="mt-2 text-[11px] font-semibold text-muted-foreground">Parámetros de la URL</p>
            <JsonTree value={sample.query} rootPath="query" onPick={(path) => pickInto(slot, path)} />
          </>
        )}
      </div>
    ) : null;

  const pickButton = (slot: number | "tags" | `attr:${number}`) =>
    sample ? (
      <button type="button" onClick={() => setPicking(picking === slot ? null : slot)} className="shrink-0 rounded-lg border border-border px-2 text-xs hover:bg-accent" aria-label="Elegir del ejemplo" title="Elegir del ejemplo">Elegir</button>
    ) : null;

  if (loadError) return <p role="alert" className="text-sm text-red-600">{loadError}</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Busca a la persona por teléfono, email o red (nunca por nombre), la crea o la actualiza, anota de dónde vino y sigue por <strong>Listo</strong>. Si no hay con qué identificarla, sigue por <strong>No se pudo</strong>.
      </p>

      {!endpointId && <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">Elegí primero el endpoint en el disparador «Webhook recibido»: de ahí sale el ejemplo para armar el mapeo.</p>}
      {endpointId && context && !sample && <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">Escuchá un envío de prueba en el disparador para elegir los campos con un clic. Mientras tanto podés escribir las rutas a mano (por ejemplo <code>data.email</code>).</p>}

      <div className="grid grid-cols-1 gap-3">
        <div>
          <label htmlFor="up-mode" className={labelClass}>Modo</label>
          <select id="up-mode" value={config.mode} onChange={(e) => patch({ mode: e.target.value as UpsertContactConfig["mode"] })} className={inputClass}>
            <option value="create_or_update">Crear o actualizar</option>
            <option value="update_only">Solo actualizar (si no existe, «No se pudo»)</option>
          </select>
        </div>
        <div>
          <label htmlFor="up-update" className={labelClass}>Al actualizar</label>
          <select id="up-update" value={config.update} onChange={(e) => patch({ update: e.target.value as UpsertContactConfig["update"] })} className={inputClass}>
            <option value="fill_empty">Completar solo lo vacío</option>
            <option value="overwrite">Sobrescribir lo mapeado</option>
          </select>
        </div>
        <div>
          <label htmlFor="up-medium" className={labelClass}>Medio del toque</label>
          <select id="up-medium" value={config.touchMedium} onChange={(e) => patch({ touchMedium: e.target.value as UpsertContactConfig["touchMedium"] })} className={inputClass}>
            <option value="external_form">Formulario externo</option>
            <option value="other">Otro</option>
          </select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className={labelClass}>Campos del contacto</legend>
        {config.map.length === 0 && <p className="text-xs text-muted-foreground">Todavía no mapeaste ningún campo. Sin teléfono, email o red el paso sale por «No se pudo».</p>}
        {config.map.map((row, index) => (
          <div key={index} className="space-y-1.5 rounded-lg border border-border p-2">
            <div className="flex items-center gap-1.5">
              <select aria-label="Campo del contacto" value={row.target} onChange={(e) => setRow(index, { ...row, target: e.target.value })} className={inputClass}>
                {targets.some((t) => t.value === row.target) ? null : <option value={row.target}>{row.target}</option>}
                <optgroup label="Contacto">{targets.filter((t) => t.group === "Contacto").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</optgroup>
                {targets.some((t) => t.group !== "Contacto") && <optgroup label="Campos personalizados">{targets.filter((t) => t.group !== "Contacto").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</optgroup>}
              </select>
              <button type="button" onClick={() => patch({ map: config.map.filter((_, i) => i !== index) })} aria-label="Quitar este campo" className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-red-600"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
            </div>
            <div className="flex gap-1.5">
              {isConst(row.source) ? (
                <input aria-label="Valor fijo" value={row.source.const} onChange={(e) => setRow(index, { ...row, source: { const: e.target.value } })} placeholder="Valor fijo" className={inputClass} />
              ) : (
                <input aria-label="Ruta en el envío" value={sourcePath(row.source)} onChange={(e) => setRow(index, { ...row, source: { ...row.source, path: e.target.value } })} placeholder="data.email" className={`${inputClass} font-mono text-xs`} />
              )}
              {!isConst(row.source) && pickButton(index)}
            </div>
            {picker(index)}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1"><input type="checkbox" checked={isConst(row.source)} onChange={(e) => setRow(index, { ...row, source: e.target.checked ? { const: "" } : { path: "" } })} /> Valor fijo</label>
              <select aria-label="Transformación" value={row.transform ?? ""} onChange={(e) => setRow(index, { ...row, transform: (e.target.value || undefined) as Transform | undefined })} className="rounded-lg border border-border bg-card px-1.5 py-1 text-xs">
                {TRANSFORMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {!isConst(row.source) && (
              <input aria-label="Rutas alternativas" value={(("fallbacks" in row.source ? row.source.fallbacks : undefined) ?? []).join(", ")} onChange={(e) => setRow(index, { ...row, source: { path: sourcePath(row.source), fallbacks: e.target.value.split(",").map((p) => p.trim()).filter(Boolean) } })} placeholder="Alternativas si no está: email, data.mail" className={`${inputClass} font-mono text-xs`} />
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => patch({ map: [...config.map, { target: "contact.email", source: { path: "" } }] })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs hover:bg-accent"><Plus className="h-3.5 w-3.5" aria-hidden /> Agregar campo</button>
          {sample && <button type="button" onClick={() => patch({ map: suggestMapRows(sample.payload, config.map) })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs hover:bg-accent"><Wand2 className="h-3.5 w-3.5" aria-hidden /> Sugerir campos</button>}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={labelClass}>Tags</legend>
        <p className="text-xs text-muted-foreground">Siempre se suman; nunca se sacan.</p>
        <div className="flex flex-wrap gap-1">
          {config.tags.fixed.map((id) => {
            const tag = context?.tags.find((t) => t.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                {tag?.name ?? "(tag borrado)"}
                <button type="button" aria-label={`Quitar ${tag?.name ?? "el tag"}`} onClick={() => patch({ tags: { ...config.tags, fixed: config.tags.fixed.filter((x) => x !== id) } })}>×</button>
              </span>
            );
          })}
        </div>
        <select aria-label="Agregar un tag fijo" value="" onChange={(e) => e.target.value && patch({ tags: { ...config.tags, fixed: [...new Set([...config.tags.fixed, e.target.value])] } })} className={inputClass}>
          <option value="">+ Agregar un tag fijo…</option>
          {(context?.tags ?? []).filter((t) => !config.tags.fixed.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="flex gap-1.5">
          <input aria-label="Ruta de los tags en el envío" value={config.tags.fromSource && "path" in config.tags.fromSource ? config.tags.fromSource.path : ""} onChange={(e) => patch({ tags: { ...config.tags, fromSource: e.target.value ? { path: e.target.value } : undefined } })} placeholder="Tags desde el envío (separados por coma): data.tags" className={`${inputClass} font-mono text-xs`} />
          {pickButton("tags")}
        </div>
        {picker("tags")}
        <p className="text-xs text-muted-foreground">Solo se suman tags que ya existen en el negocio; el resto se ignora.</p>
      </fieldset>

      <details className="rounded-lg border border-border p-2">
        <summary className="cursor-pointer text-xs font-semibold">
          Atribución {config.attribution.autoDetect ? `· ${Object.keys(detected).length} detectada${Object.keys(detected).length === 1 ? "" : "s"} automáticamente` : "· solo lo mapeado"}
        </summary>
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={config.attribution.autoDetect} onChange={(e) => patch({ attribution: { ...config.attribution, autoDetect: e.target.checked } })} /> Detectar automáticamente (UTMs, ids de anuncio y de clic)</label>
          {config.attribution.autoDetect && Object.keys(detected).length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">{Object.entries(detected).map(([k, v]) => <li key={k}><span className="font-mono">{k}</span> = {v}</li>)}</ul>
          )}
          {config.attribution.map.map((row, index) => (
            <div key={index} className="space-y-1">
              <div className="flex gap-1.5">
                <select aria-label="Dato de atribución" value={row.key} onChange={(e) => patch({ attribution: { ...config.attribution, map: config.attribution.map.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)) } })} className={inputClass}>
                  {WEBHOOK_ATTRIBUTION_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input aria-label="Ruta en el envío" value={sourcePath(row.source)} onChange={(e) => patch({ attribution: { ...config.attribution, map: config.attribution.map.map((r, i) => (i === index ? { ...r, source: { path: e.target.value } } : r)) } })} placeholder="ruta" className={`${inputClass} font-mono text-xs`} />
                {pickButton(`attr:${index}`)}
                <button type="button" aria-label="Quitar este dato" onClick={() => patch({ attribution: { ...config.attribution, map: config.attribution.map.filter((_, i) => i !== index) } })} className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-red-600"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
              </div>
              {picker(`attr:${index}`)}
            </div>
          ))}
          <button type="button" onClick={() => patch({ attribution: { ...config.attribution, map: [...config.attribution.map, { key: "utm_source", source: { path: "" } }] } })} className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-xs hover:bg-accent"><Plus className="h-3 w-3" aria-hidden /> Mapear un dato a mano</button>
          <p className="text-xs text-muted-foreground">Lo mapeado a mano gana sobre lo detectado. Siempre se anota un toque «Webhook», aunque no vengan UTMs.</p>
        </div>
      </details>

      <div className="space-y-2 border-t border-border pt-3">
        <button type="button" onClick={runTest} disabled={pending || !endpointId} className="h-8 w-full rounded-lg border border-emerald-600 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-300">
          {pending ? "Probando…" : "Probar con el ejemplo"}
        </button>
        {testError && <p role="alert" className="text-xs text-red-600">{testError}</p>}
        {preview && <PreviewView preview={preview} />}
      </div>
    </div>
  );
}

const REASON: Record<string, string> = {
  email_invalido: "no es un email",
  telefono_invalido: "no es un teléfono válido",
  pais_no_reconocido: "país no reconocido",
  usuario_invalido: "no es un usuario válido",
  campo_personalizado_inexistente: "ese campo personalizado ya no existe",
  no_es_un_numero: "no es un número",
  no_es_si_no: "no es sí/no",
  fecha_invalida: "fecha inválida",
  url_invalida: "no es una URL",
};

function PreviewView({ preview }: { preview: UpsertPreview }) {
  const o = preview.outcome;
  return (
    <div role="status" className="space-y-2 text-xs">
      <p className="rounded-lg bg-muted p-2 font-medium">
        {o.kind === "create" && "Se crearía un contacto nuevo."}
        {o.kind === "update" && (o.name ? `Se actualizaría a ${o.name}.` : "Se actualizaría un contacto que ya existe.")}
        {o.kind === "fail" && (o.reason === "no_identifier" ? "No se pudo: el envío no trae teléfono, email ni usuario de red." : "No se pudo: no existe y el paso solo actualiza.")}
      </p>
      {preview.conflicts > 0 && <p className="text-amber-700 dark:text-amber-300">Atención: otros datos del envío coinciden con otro contacto. Se usaría el principal y no se fusionaría nada.</p>}
      <ul className="space-y-0.5">
        {preview.rows.map((r, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden className={r.status === "ok" ? "text-emerald-600" : r.status === "error" ? "text-red-600" : "text-muted-foreground"}>●</span>
            <span className="font-mono">{r.target.replace("contact.", "")}</span>
            <span className="min-w-0 truncate text-muted-foreground">{r.status === "ok" ? `→ ${r.value}` : r.status === "empty" ? "vacío" : `error: ${REASON[r.reason ?? ""] ?? r.reason}${r.raw ? ` («${r.raw}»)` : ""}`}</span>
          </li>
        ))}
      </ul>
      {(preview.tagNames.length > 0 || preview.unknownTags.length > 0) && <p>Tags: {preview.tagNames.filter((n) => !preview.unknownTags.includes(n)).join(", ") || "—"}{preview.unknownTags.length > 0 ? ` (no existen y se ignoran: ${preview.unknownTags.join(", ")})` : ""}</p>}
      {Object.keys(preview.attribution).length > 0 && <p>Atribución: {Object.entries(preview.attribution).map(([k, v]) => `${k}=${v}`).join(", ")}</p>}
    </div>
  );
}

export { DEFAULT_UPSERT_CONFIG };
