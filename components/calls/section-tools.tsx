"use client";

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareWarning, Pencil, Sparkles } from "lucide-react";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";
import { objectToAnalysis, resolveObjection } from "@/lib/actions/calls-objection";
import { OBJECTION_NOTE_MAX } from "@/lib/calls/edit-rules";
import { getSection, SECTION_LABELS, type AnalysisSection } from "@/lib/calls/scoring";
import { describeSectionValue } from "@/lib/calls/section-forms";
import { AiCorrectionModal } from "@/components/calls/ai-correction-modal";
import { SectionEditor, type CategorySuggestions } from "@/components/calls/section-editor";

export interface CallObjection {
  id: string;
  section: string;
  by: string;
  at: string;
  note: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface CallEditState {
  callId: string;
  /** Tiene `calls.edit`: corregir, revisar con IA y marcar objeciones como resueltas. */
  canEdit: boolean;
  /** Es el closer de ESTA llamada: puede objetar. */
  isCloser: boolean;
  suggestions: CategorySuggestions;
  objections: CallObjection[];
  /** Lo que dijo la IA, sin tocar: para ver que cambio una persona. */
  analysisAi: unknown;
  analysis: unknown;
  names: Record<string, string>;
}

const Ctx = createContext<CallEditState | null>(null);
export const CallEditProvider = Ctx.Provider;

/**
 * Las herramientas de una seccion del analisis (F23, F24, F28): corregir a
 * mano, revisar con IA y, para el closer de la llamada, "No estoy de acuerdo".
 * Tambien muestra las objeciones de esa seccion y si fue editada. Sin permiso
 * y sin objeciones, no pinta nada.
 */
export function SectionTools({ section }: { section: AnalysisSection }) {
  const state = useContext(Ctx);
  const router = useRouter();
  const [modal, setModal] = useState<"edit" | "ai" | "object" | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const edited = useMemo(() => {
    if (!state) return false;
    return JSON.stringify(getSection(state.analysis, section) ?? null) !== JSON.stringify(getSection(state.analysisAi, section) ?? null);
  }, [state, section]);
  if (!state) return null;

  const mine = state.objections.filter((o) => o.section === section);
  if (!state.canEdit && !state.isCloser && mine.length === 0 && !edited) return null;

  const resolve = (objectionId: string) => {
    setError(null);
    start(async () => {
      const result = await resolveObjection({ callId: state.callId, objectionId });
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  };

  const btn = "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground";
  const label = SECTION_LABELS[section];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {edited && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-950/60 dark:text-sky-300" title="Una persona corrigió esta sección. Quién y cuándo, en Técnico → Historial.">
            Editado
          </span>
        )}
        {state.canEdit && (
          <>
            <button type="button" onClick={() => setModal("edit")} className={btn} aria-label={`Editar ${label}`}><Pencil className="h-3 w-3" aria-hidden /> Editar</button>
            <button type="button" onClick={() => setModal("ai")} className={btn} aria-label={`Revisar ${label} con IA`}><Sparkles className="h-3 w-3" aria-hidden /> Revisar con IA</button>
          </>
        )}
        {state.isCloser && (
          <button type="button" onClick={() => setModal("object")} className={btn} aria-label={`No estoy de acuerdo con ${label}`}><MessageSquareWarning className="h-3 w-3" aria-hidden /> No estoy de acuerdo</button>
        )}
      </div>

      {edited && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Ver lo que dijo la IA</summary>
          <p className="mt-1 whitespace-pre-line rounded-md bg-muted/50 p-2">{describeSectionValue(section, getSection(state.analysisAi, section))}</p>
        </details>
      )}

      {mine.map((o) => (
        <div key={o.id} className={`rounded-md border p-2 text-xs ${o.resolved_at ? "border-border text-muted-foreground" : "border-amber-500/40 bg-amber-500/10"}`}>
          <p>
            <span className="font-medium">{state.names[o.by] ?? "El closer"} no está de acuerdo:</span> {o.note}
          </p>
          {o.resolved_at ? (
            <p className="mt-0.5">Resuelta por {o.resolved_by ? (state.names[o.resolved_by] ?? "alguien del equipo") : "alguien del equipo"} el {new Date(o.resolved_at).toLocaleDateString("es")}.</p>
          ) : (
            state.canEdit && (
              <button type="button" disabled={pending} onClick={() => resolve(o.id)} className="mt-1 rounded-md border border-border px-2 py-0.5 font-medium hover:bg-accent disabled:opacity-50">Marcar resuelta</button>
            )
          )}
        </div>
      ))}
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}

      {modal === "edit" && <SectionEditor callId={state.callId} section={section} value={getSection(state.analysis, section)} suggestions={state.suggestions} onClose={() => setModal(null)} />}
      {modal === "ai" && <AiCorrectionModal callId={state.callId} section={section} onClose={() => setModal(null)} />}
      {modal === "object" && <ObjectionModal callId={state.callId} section={section} onClose={() => setModal(null)} />}
    </div>
  );
}

function ObjectionModal({ callId, section, onClose }: { callId: string; section: AnalysisSection; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    start(async () => {
      const result = await objectToAnalysis({ callId, section, note });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <ContentDialog
      title={`No estoy de acuerdo: ${SECTION_LABELS[section]}`}
      label={`Objetar ${SECTION_LABELS[section]}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={send} disabled={pending || note.trim().length < 3} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{pending ? "Enviando…" : "Enviar"}</button>
          <button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">Cancelar</button>
          {error && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</span>}
        </>
      }
    >
      <p className="text-xs text-muted-foreground">Esto no cambia ningún puntaje: deja una marca para que quien revisa las llamadas lo vea y te responda.</p>
      <DialogField label="¿Por qué no estás de acuerdo?" hint={`${note.length} de ${OBJECTION_NOTE_MAX} caracteres`}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} maxLength={OBJECTION_NOTE_MAX} className={`${fieldInput} resize-y`} />
      </DialogField>
    </ContentDialog>
  );
}
