"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Settings } from "lucide-react";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";
import { analyzeCall, changeCallType, regenerateCall, setCallNoShow } from "@/lib/actions/calls-edit";
import type { CategoryGroup } from "@/lib/calls/catalog";
import { REGENERATE_CONTEXT_MAX, REGENERATE_CONTEXT_MIN, REGENERATE_REASONS, REGENERATE_REASON_LABELS, type RegenerateReason } from "@/lib/calls/edit-rules";
import type { BannerAction } from "@/lib/calls/detail-view";

/**
 * Los botones de la ficha que mueven el estado de una llamada (F18, F22, F25):
 * elegir el tipo, analizar o reintentar, regenerar, e ir a la configuracion.
 * Todo lo que escribe lo hace una Server Action que vuelve a chequear permisos.
 */

export function TypeSelect({ callId, current, groups, disabled, label = "Área y tipo de la grabación" }: { callId: string; current: string | null; groups: CategoryGroup[]; disabled?: boolean; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select
        id={id}
        value={current ?? ""}
        disabled={disabled || pending}
        onChange={(e) => {
          setError(null);
          start(async () => {
            const result = await changeCallType({ callId, categoryId: e.target.value });
            if (!result.ok) return setError(result.error);
            router.refresh();
          });
        }}
        className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      >
        {!current && <option value="">Elegí el área y el tipo…</option>}
        {groups.map((g) => (
          <optgroup key={g.areaId} label={g.areaName}>
            <option value={g.areaId}>{g.areaName} (sin tipo)</option>
            {g.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </optgroup>
        ))}
      </select>
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
      {error && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </span>
  );
}

/** Marcar o sacar "no se presentó": es una marca, no un tipo. */
export function NoShowToggle({ callId, noShow }: { callId: string; noShow: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await setCallNoShow({ callId, noShow: !noShow });
            if (!result.ok) return setError(result.error);
            router.refresh();
          });
        }}
        className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        {noShow ? "Sacar «no se presentó»" : "Marcar «no se presentó»"}
      </button>
      {error && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </>
  );
}

export function AnalyzeButton({ callId, label, disabledReason }: { callId: string; label: string; disabledReason?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending || !!disabledReason}
        title={disabledReason ?? undefined}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await analyzeCall({ callId });
            if (!result.ok) return setError(result.error);
            router.refresh();
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {label}
      </button>
      {disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
      {error && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </span>
  );
}

/** El boton que acompaña al banner de la ficha, segun `detailView`. */
export function BannerActionButton({ action, callId, categoryId, groups, disabledReason }: { action: BannerAction; callId: string; categoryId: string | null; groups: CategoryGroup[]; disabledReason?: string | null }) {
  if (action === "choose_type") return <TypeSelect callId={callId} current={categoryId} groups={groups} label="Elegí el área y el tipo" />;
  if (action === "analyze") return <AnalyzeButton callId={callId} label="Analizar" disabledReason={disabledReason} />;
  if (action === "retry") return <AnalyzeButton callId={callId} label="Reintentar" disabledReason={disabledReason} />;
  if (action === "config") {
    return (
      <Link href="/dashboard/agents/tareas/call_analysis?tab=config" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
        <Settings className="h-4 w-4" aria-hidden /> Configurar qué se analiza
      </Link>
    );
  }
  return null;
}

/** Regenerar el analisis con un motivo obligatorio (F25). Avisa que se pierden las correcciones a mano. */
export function RegenerateButton({ callId, hasEdits }: { callId: string; hasEdits: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
        <RefreshCw className="h-4 w-4" aria-hidden /> Regenerar
      </button>
      {open && <RegenerateModal callId={callId} hasEdits={hasEdits} onClose={() => setOpen(false)} />}
    </>
  );
}

function RegenerateModal({ callId, hasEdits, onClose }: { callId: string; hasEdits: boolean; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState<RegenerateReason | "">("");
  const [context, setContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const needsContext = reason === "falta_contexto";
  const contextOk = !needsContext || (context.trim().length >= REGENERATE_CONTEXT_MIN && context.trim().length <= REGENERATE_CONTEXT_MAX);

  function go() {
    setError(null);
    start(async () => {
      const result = await regenerateCall({ callId, reason, context });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <ContentDialog
      title="Regenerar el análisis"
      label="Regenerar el análisis"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={go} disabled={pending || !reason || !contextOk} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{pending ? "Enviando…" : "Regenerar"}</button>
          <button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">Cancelar</button>
          {error && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</span>}
        </>
      }
    >
      <p className="text-sm text-muted-foreground">Se hace un análisis nuevo con las instrucciones y la rúbrica de hoy. Cuesta una corrida de IA.</p>
      {hasEdits && (
        <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-sm">
          Esta llamada tiene correcciones hechas a mano. Se pierden en el análisis nuevo (quedan en el historial, con el análisis anterior completo).
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">¿Por qué la regenerás?</legend>
        {REGENERATE_REASONS.map((r) => (
          <label key={r} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="regen-reason" checked={reason === r} onChange={() => setReason(r)} className="h-4 w-4" />
            {REGENERATE_REASON_LABELS[r]}
          </label>
        ))}
      </fieldset>
      {needsContext && (
        <DialogField label="¿Qué contexto faltaba?" hint={`${context.trim().length} de ${REGENERATE_CONTEXT_MAX} caracteres (mínimo ${REGENERATE_CONTEXT_MIN}). La IA lo lee como dato, no como una orden.`}>
          <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={4} maxLength={REGENERATE_CONTEXT_MAX} className={`${fieldInput} resize-y`} />
        </DialogField>
      )}
    </ContentDialog>
  );
}
