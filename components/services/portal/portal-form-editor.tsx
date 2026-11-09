"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { savePortalForm, type PortalFormField } from "@/lib/actions/program";
import { quizDefinitionIssues, type QuizSettings } from "@/lib/program/quiz";
import { DEFAULT_PASS_AT, GRADING_SCALES, SCALE_LABELS, WORD_LABELS, WORD_SCALE, gradingIssues, type GradingDef } from "@/lib/program/grading";
import { fieldInput } from "@/components/content/dialog";

type Kind = "quiz" | "activity" | "terms";

export interface PortalFormInitial {
  name: string;
  intro: string;
  fields: PortalFormField[];
  quiz: QuizSettings;
  grading: GradingDef;
}

const TYPES: Record<Kind, Array<{ v: PortalFormField["type"]; label: string }>> = {
  quiz: [
    { v: "single_select", label: "Una correcta" },
    { v: "multi_select", label: "Varias correctas" },
  ],
  activity: [
    { v: "long_text", label: "Texto largo" },
    { v: "short_text", label: "Texto corto" },
    { v: "file", label: "Archivo" },
    { v: "single_select", label: "Selección única" },
    { v: "multi_select", label: "Selección múltiple" },
  ],
  terms: [{ v: "consent", label: "Compromiso para tildar" }],
};

let keySeq = 0;
const newKey = (fields: PortalFormField[]) => {
  let k = "";
  do k = `p${(Date.now() % 100000) + keySeq++}`;
  while (fields.some((f) => f.key === k));
  return k;
};

/**
 * El editor de una evaluación, una actividad o los términos (F52-F55, F113). La evaluación: solo preguntas cerradas,
 * con puntos y la(s) correcta(s), y el % para aprobar e intentos; la corrige la base y las correctas nunca viajan al
 * portal. La actividad: cualquier pregunta y la calificación opcional con su escala. Los términos: un texto y los
 * compromisos para tildar.
 */
export function PortalFormEditor({ productId, kind, itemId, initial, canEdit }: { productId: string; kind: Kind; itemId?: string; initial: PortalFormInitial; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [intro, setIntro] = useState(initial.intro);
  const [fields, setFields] = useState<PortalFormField[]>(initial.fields);
  const [quiz, setQuiz] = useState<QuizSettings>({ pass_pct: 70, attempts: 1, show_grade: true, show_correct: false, ...initial.quiz });
  const [grading, setGrading] = useState<GradingDef>({ enabled: false, ...initial.grading });
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const setField = (key: string, patch: Partial<PortalFormField>) => setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const setQuestion = (key: string, patch: Partial<NonNullable<QuizSettings["questions"]>[string]>) =>
    setQuiz((q) => ({ ...q, questions: { ...(q.questions ?? {}), [key]: { points: 1, correct: [], ...(q.questions?.[key] ?? {}), ...patch } } }));

  function add() {
    const key = newKey(fields);
    const type = TYPES[kind][0].v;
    setFields((fs) => [...fs, { key, type, label: "", required: true, ...(type === "single_select" || type === "multi_select" ? { options: ["", ""] } : {}) }]);
    if (kind === "quiz") setQuestion(key, { points: 1, correct: [] });
  }

  function remove(key: string) {
    setFields((fs) => fs.filter((f) => f.key !== key));
    setQuiz((q) => {
      const qs = { ...(q.questions ?? {}) };
      delete qs[key];
      return { ...q, questions: qs };
    });
  }

  function save() {
    const clean = fields.map((f) => ({ ...f, label: f.label.trim(), options: f.options?.map((o) => o.trim()).filter(Boolean) }));
    const problems = kind === "quiz" ? quizDefinitionIssues(quiz, clean) : kind === "activity" ? gradingIssues(grading) : [];
    if (problems.length) return setMsg({ kind: "error", text: problems.join(". ") });
    setMsg(null);
    start(async () => {
      const res = await savePortalForm(productId, kind === "terms" ? { kind } : { kind, itemId: itemId as string }, { name, intro, fields: clean, quiz, grading });
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      setMsg({ kind: "ok", text: "Guardado y publicado." });
      router.refresh();
    });
  }

  const disabled = !canEdit || pending;
  return (
    <div className="space-y-3">
      {kind !== "terms" && (
        <p className="text-xs text-muted-foreground">
          Es un formulario de este programa: no aparece en Formularios.{kind === "quiz" ? " La nota la calcula el sistema; las respuestas correctas nunca se envían al portal." : ""}
        </p>
      )}
      <label className="block text-xs text-muted-foreground">
        Nombre
        <input className={fieldInput} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block text-xs text-muted-foreground">
        {kind === "terms" ? "Texto de los términos" : "Instrucciones"}
        <textarea className={fieldInput} rows={kind === "terms" ? 6 : 3} value={intro} disabled={disabled} onChange={(e) => setIntro(e.target.value)} />
      </label>

      <ol className="space-y-3">
        {fields.map((f, idx) => {
          const q = quiz.questions?.[f.key];
          return (
            <li key={f.key} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{idx + 1}.</span>
                <input className={fieldInput} value={f.label} disabled={disabled} placeholder={kind === "terms" ? "Me comprometo a…" : "Pregunta"} onChange={(e) => setField(f.key, kind === "terms" ? { label: e.target.value, consentText: e.target.value } : { label: e.target.value })} />
                {canEdit && (
                  <button type="button" aria-label="Sacar la pregunta" onClick={() => remove(f.key)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              {TYPES[kind].length > 1 && (
                <select className={fieldInput} value={f.type} disabled={disabled} onChange={(e) => setField(f.key, { type: e.target.value as PortalFormField["type"], options: e.target.value.endsWith("select") ? f.options ?? ["", ""] : undefined })}>
                  {TYPES[kind].map((t) => (
                    <option key={t.v} value={t.v}>
                      {t.label}
                    </option>
                  ))}
                </select>
              )}
              {(f.type === "single_select" || f.type === "multi_select") && (
                <ul className="space-y-1">
                  {(f.options ?? []).map((o, oi) => (
                    <li key={oi} className="flex items-center gap-2">
                      {kind === "quiz" && (
                        <input
                          type={f.type === "single_select" ? "radio" : "checkbox"}
                          name={`correct-${f.key}`}
                          aria-label="Correcta"
                          checked={!!o && (q?.correct ?? []).includes(o)}
                          disabled={disabled || !o}
                          onChange={(e) => {
                            const cur = q?.correct ?? [];
                            setQuestion(f.key, { correct: f.type === "single_select" ? [o] : e.target.checked ? [...cur, o] : cur.filter((c) => c !== o) });
                          }}
                        />
                      )}
                      <input
                        className={fieldInput}
                        value={o}
                        disabled={disabled}
                        placeholder={`Opción ${oi + 1}`}
                        onChange={(e) => {
                          const opts = [...(f.options ?? [])];
                          const old = opts[oi];
                          opts[oi] = e.target.value;
                          setField(f.key, { options: opts });
                          if (kind === "quiz" && q?.correct.includes(old)) setQuestion(f.key, { correct: q.correct.map((c) => (c === old ? e.target.value : c)) });
                        }}
                      />
                    </li>
                  ))}
                  {canEdit && (
                    <li>
                      <button type="button" onClick={() => setField(f.key, { options: [...(f.options ?? []), ""] })} className="text-xs text-primary-ink hover:underline">
                        + Opción
                      </button>
                    </li>
                  )}
                </ul>
              )}
              {kind === "quiz" && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <label className="flex items-center gap-1">
                    Puntos
                    <input type="number" min={1} className="w-16 rounded border border-border bg-background px-2 py-1" value={q?.points ?? 1} disabled={disabled} onChange={(e) => setQuestion(f.key, { points: Number(e.target.value) })} />
                  </label>
                  {f.type === "multi_select" && (
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={!!q?.partial} disabled={disabled} onChange={(e) => setQuestion(f.key, { partial: e.target.checked })} /> Puntaje parcial
                    </label>
                  )}
                </div>
              )}
              {kind === "activity" && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={f.required} disabled={disabled} onChange={(e) => setField(f.key, { required: e.target.checked })} /> Obligatoria
                </label>
              )}
            </li>
          );
        })}
      </ol>
      {canEdit && (
        <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
          <Plus className="h-4 w-4" aria-hidden /> {kind === "terms" ? "Compromiso" : "Pregunta"}
        </button>
      )}

      {kind === "quiz" && (
        <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 text-xs text-muted-foreground">
          <legend className="px-1 font-semibold text-foreground">Ajustes</legend>
          <label>
            % para aprobar
            <input type="number" min={1} max={100} className={fieldInput} value={quiz.pass_pct ?? 70} disabled={disabled} onChange={(e) => setQuiz({ ...quiz, pass_pct: Number(e.target.value) })} />
          </label>
          <label>
            Intentos
            <input type="number" min={1} max={20} className={fieldInput} value={quiz.attempts ?? 1} disabled={disabled} onChange={(e) => setQuiz({ ...quiz, attempts: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={quiz.show_grade !== false} disabled={disabled} onChange={(e) => setQuiz({ ...quiz, show_grade: e.target.checked })} /> Mostrar la nota
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!quiz.show_correct} disabled={disabled} onChange={(e) => setQuiz({ ...quiz, show_correct: e.target.checked })} /> Mostrar las correctas al terminar
          </label>
        </fieldset>
      )}

      {kind === "activity" && (
        <fieldset className="space-y-2 rounded-lg border border-border p-3 text-xs text-muted-foreground">
          <legend className="px-1 font-semibold text-foreground">Calificación</legend>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={!!grading.enabled} disabled={disabled} onChange={(e) => setGrading({ ...grading, enabled: e.target.checked, scale: grading.scale ?? "pass" })} /> Calificar esta actividad
          </label>
          {grading.enabled && (
            <>
              <select className={fieldInput} value={grading.scale ?? "pass"} disabled={disabled} onChange={(e) => setGrading({ ...grading, scale: e.target.value, pass_at: e.target.value === "pass" ? null : DEFAULT_PASS_AT[e.target.value as keyof typeof DEFAULT_PASS_AT] })}>
                {GRADING_SCALES.map((s) => (
                  <option key={s} value={s}>
                    {SCALE_LABELS[s]}
                  </option>
                ))}
              </select>
              {grading.scale && grading.scale !== "pass" && (
                <label className="block">
                  Aprueba desde
                  {grading.scale === "words" ? (
                    <select className={fieldInput} value={String(grading.pass_at ?? "bueno")} disabled={disabled} onChange={(e) => setGrading({ ...grading, pass_at: e.target.value })}>
                      {WORD_SCALE.map((w) => (
                        <option key={w} value={w}>
                          {WORD_LABELS[w]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input type="number" className={fieldInput} value={Number(grading.pass_at ?? DEFAULT_PASS_AT[grading.scale as keyof typeof DEFAULT_PASS_AT])} disabled={disabled} onChange={(e) => setGrading({ ...grading, pass_at: Number(e.target.value) })} />
                  )}
                </label>
              )}
            </>
          )}
        </fieldset>
      )}

      {msg && (
        <p role="status" className={msg.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {msg.text}
        </p>
      )}
      {canEdit && (
        <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {pending ? "Guardando…" : "Guardar y publicar"}
        </button>
      )}
    </div>
  );
}
