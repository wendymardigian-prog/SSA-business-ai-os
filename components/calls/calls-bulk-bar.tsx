"use client";

/**
 * La selección múltiple de Grabaciones: la barra roja de abajo («N seleccionadas · Cambiar tipo · Volver a clasificar ·
 * Analizar con IA · Eliminar»; roja para que se vea al seleccionar) y la ventanita que pide el tipo de las que no lo
 * tienen antes de analizarlas. Las reglas (qué se elige, el tope de 20, el aviso) están en `lib/calls/bulk.ts` y
 * `lib/calls/reclassify-request.ts`; quién puede y qué se guarda lo decide el servidor (`calls.edit`, la RLS).
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Sparkles, Tags, Trash2, X } from "lucide-react";
import { ContentDialog } from "@/components/content/dialog";
import { changeCallTypeMany, classifyAndAnalyzeCalls, reclassifyCalls } from "@/lib/actions/calls-edit";
import type { CategoryGroup } from "@/lib/calls/catalog";
import { BULK_ANALYZE_LIMIT, BULK_TYPE_LIMIT, bulkAnalyzeSummary, planBulkAnalyze } from "@/lib/calls/bulk";
import { RECLASSIFY_LIMIT, reclassifySummary } from "@/lib/calls/reclassify-request";
import { cn } from "@/lib/utils";

export interface BulkItem {
  callId: string;
  title: string;
  subtitle: string;
  categoryId: string | null;
  needsType: boolean;
}

/** Las opciones de área y tipo, como el selector de la ficha (un área sola es «sin tipo»). */
export function TypeOptions({ groups }: { groups: CategoryGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.areaId} label={g.areaName}>
          <option value={g.areaId}>{g.areaName} (sin tipo)</option>
          {g.types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

const SELECT = "rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
const BAR_BUTTON = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-50";
const BAR_OUTLINE = "border border-white/50 hover:bg-white/15";

export function CallsBulkBar({
  selected,
  groups,
  canEdit,
  canDelete,
  onClear,
  onResult,
  onDelete,
}: {
  selected: BulkItem[];
  groups: CategoryGroup[];
  canEdit: boolean;
  canDelete: boolean;
  onClear: () => void;
  /** El resultado, para mostrarlo en la lista (la barra se va al quitar la selección). */
  onResult: (text: string) => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [typeOpen, setTypeOpen] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const plan = useMemo(() => planBulkAnalyze(selected), [selected]);

  const analyze = (types: Array<{ callId: string; categoryId: string }>) => {
    setMessage(null);
    start(async () => {
      const res = await classifyAndAnalyzeCalls({ callIds: plan.toAnalyze.map((c) => c.callId), types });
      if (!res.ok) return setMessage(res.error);
      setAnalyzeOpen(false);
      onResult(bulkAnalyzeSummary(res, plan.overLimit));
      onClear();
      router.refresh();
    });
  };

  const reclassify = () => {
    setMessage(null);
    start(async () => {
      const res = await reclassifyCalls({ callIds: selected.slice(0, RECLASSIFY_LIMIT).map((c) => c.callId) });
      if (!res.ok) return setMessage(res.error);
      onResult(reclassifySummary(res));
      onClear();
      router.refresh();
    });
  };

  return (
    <>
      <div
        role="region"
        aria-label="Grabaciones seleccionadas"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-red-700 bg-red-600 px-4 py-2.5 text-white shadow-lg shadow-red-900/30 md:inset-x-auto md:bottom-4 md:left-1/2 md:-translate-x-1/2 md:rounded-xl md:border dark:border-red-500 dark:bg-red-700"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold tabular-nums">{selected.length === 1 ? "1 seleccionada" : `${selected.length} seleccionadas`}</span>
          {canEdit && (
            <>
              <button type="button" disabled={pending} onClick={() => setTypeOpen(true)} className={cn(BAR_BUTTON, BAR_OUTLINE)}>
                <Tags className="h-4 w-4" aria-hidden /> Cambiar tipo
              </button>
              <button type="button" disabled={pending} onClick={reclassify} className={cn(BAR_BUTTON, BAR_OUTLINE)}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Volver a clasificar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => (plan.needType.length > 0 ? setAnalyzeOpen(true) : analyze([]))}
                className={cn(BAR_BUTTON, "bg-white text-red-700 hover:bg-red-50")}
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />} Analizar con IA
              </button>
            </>
          )}
          {canDelete && (
            <button type="button" disabled={pending} onClick={onDelete} className={cn(BAR_BUTTON, BAR_OUTLINE)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Eliminar
            </button>
          )}
          <button type="button" onClick={onClear} disabled={pending} className={cn(BAR_BUTTON, "text-white/85 hover:bg-white/15 hover:text-white")}>
            <X className="h-4 w-4" aria-hidden /> Quitar selección
          </button>
        </div>
        {canEdit && plan.overLimit > 0 && <p className="mt-1 text-xs text-white/85">Se analizan como máximo {BULK_ANALYZE_LIMIT} por vez: se enviarán las primeras {BULK_ANALYZE_LIMIT}.</p>}
        {canEdit && selected.length > RECLASSIFY_LIMIT && <p className="mt-1 text-xs text-white/85">Cambiar el tipo y volver a clasificar alcanzan hasta {RECLASSIFY_LIMIT} por vez.</p>}
        {message && (
          <p role="alert" className="mt-1 max-w-xl text-xs font-medium text-white">
            {message}
          </p>
        )}
      </div>

      {typeOpen && (
        <BulkTypeDialog
          count={Math.min(selected.length, BULK_TYPE_LIMIT)}
          groups={groups}
          pending={pending}
          onClose={() => setTypeOpen(false)}
          onSave={(categoryId) => {
            setMessage(null);
            start(async () => {
              const res = await changeCallTypeMany({ callIds: selected.slice(0, BULK_TYPE_LIMIT).map((c) => c.callId), categoryId });
              if (!res.ok) return setMessage(res.error);
              setTypeOpen(false);
              onResult(res.failed ? `Tipo cambiado en ${res.changed}; ${res.failed} no se pudieron cambiar.` : res.changed === 1 ? "Tipo cambiado en 1 grabación." : `Tipo cambiado en ${res.changed} grabaciones.`);
              onClear();
              router.refresh();
            });
          }}
        />
      )}

      {analyzeOpen && <ClassifyFirstDialog items={plan.needType} total={plan.toAnalyze.length} groups={groups} pending={pending} onClose={() => setAnalyzeOpen(false)} onConfirm={analyze} />}
    </>
  );
}

function BulkTypeDialog({ count, groups, pending, onClose, onSave }: { count: number; groups: CategoryGroup[]; pending: boolean; onClose: () => void; onSave: (categoryId: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <ContentDialog
      title="Cambiar el tipo"
      label="Cambiar el tipo de las grabaciones seleccionadas"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-sm hover:bg-accent">Cancelar</button>
          <button type="button" disabled={!value || pending} onClick={() => onSave(value)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Aplicar a {count === 1 ? "1 grabación" : `${count} grabaciones`}
          </button>
        </>
      }
    >
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Área y tipo</span>
        <select value={value} onChange={(e) => setValue(e.target.value)} className={cn(SELECT, "w-full")}>
          <option value="">Elegí el área y el tipo…</option>
          <TypeOptions groups={groups} />
        </select>
      </label>
      <p className="mt-2 text-xs text-muted-foreground">Las que queden con un tipo que se analiza solo se pondrán en la cola del análisis, como al cambiarlo de una en una.</p>
    </ContentDialog>
  );
}

/** Antes de analizar: el tipo de las que no lo tienen (o lo tienen por revisar), ya con lo que adivinó la IA. */
function ClassifyFirstDialog({
  items,
  total,
  groups,
  pending,
  onClose,
  onConfirm,
}: {
  items: BulkItem[];
  total: number;
  groups: CategoryGroup[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (types: Array<{ callId: string; categoryId: string }>) => void;
}) {
  const valid = useMemo(() => new Set(groups.flatMap((g) => [g.areaId, ...g.types.map((t) => t.id)])), [groups]);
  const [chosen, setChosen] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.callId, i.categoryId && valid.has(i.categoryId) ? i.categoryId : ""])));
  const [all, setAll] = useState("");
  const missing = items.filter((i) => !chosen[i.callId]).length;
  return (
    <ContentDialog
      title="Primero, el tipo de grabación"
      label="Elegir el tipo antes de analizar"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-sm hover:bg-accent">Cancelar</button>
          <button
            type="button"
            disabled={missing > 0 || pending}
            onClick={() => onConfirm(items.map((i) => ({ callId: i.callId, categoryId: chosen[i.callId] })))}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />} Guardar y analizar {total}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {items.length === 1 ? "1 grabación no tiene" : `${items.length} grabaciones no tienen`} el tipo confirmado. El análisis usa el analizador de cada tipo, así que hay que elegirlo antes.
        {missing > 0 && <span className="block pt-1 text-foreground">{missing === 1 ? "Falta 1." : `Faltan ${missing}.`}</span>}
      </p>
      <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Aplicar el mismo tipo a todas:</span>
        <select
          value={all}
          onChange={(e) => {
            setAll(e.target.value);
            if (e.target.value) setChosen(Object.fromEntries(items.map((i) => [i.callId, e.target.value])));
          }}
          className={SELECT}
        >
          <option value="">Elegí…</option>
          <TypeOptions groups={groups} />
        </select>
      </label>
      <ul className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
        {items.map((i) => (
          <li key={i.callId} className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5 sm:flex-row sm:items-center">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{i.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{i.subtitle}</span>
            </span>
            <select value={chosen[i.callId] ?? ""} onChange={(e) => setChosen((cur) => ({ ...cur, [i.callId]: e.target.value }))} aria-label={`Tipo de ${i.title}`} className={cn(SELECT, "sm:w-56")}>
              <option value="">Elegí…</option>
              <TypeOptions groups={groups} />
            </select>
          </li>
        ))}
      </ul>
    </ContentDialog>
  );
}
