"use client";
// @plantilla-quitar(servicios)

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewSubmission, submissionFileUrl } from "@/lib/actions/program";
import { filesOfAnswers } from "@/lib/forms/files";
import type { ReviewItem } from "@/lib/program/load-review";
import { gradeLabel, isLatestSubmission, matchesReviewFilter, reviewRowView, submissionHistory, type ReviewFilter } from "@/lib/program/review";
import { SCALE_LABELS, WORD_LABELS, WORD_SCALE } from "@/lib/program/grading";
import { ratingAnswerLabel } from "@/lib/program/activity-survey";
import { fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";
import { ClickableTr } from "@/components/ui/clickable-row";

const TONE: Record<string, string> = { todo: "text-foreground", warn: "text-warn", done: "text-muted-foreground", info: "text-muted-foreground" };

/**
 * Portal › Por revisar (F57): las entregas de todos los programas y el drawer para revisar o calificar (comentario
 * para el estudiante y nota interna, que nunca ve el estudiante). Revisar pide `submissions.review`. El filtro vive en
 * la barra superior (`?filtro=`, Servicios A2): aca solo se recibe.
 */
export function ReviewList({ items, canReview, timeZone, filter }: { items: ReviewItem[]; canReview: boolean; timeZone: string; filter: ReviewFilter }) {
  const router = useRouter();
  const [open, setOpen] = useState<ReviewItem | null>(null);
  const shown = useMemo(() => items.filter((i) => matchesReviewFilter(i, filter)), [items, filter]);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="space-y-3">
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay entregas con este filtro.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Estudiante</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Qué entregó</th>
                <th className="px-3 py-2 font-medium">Programa</th>
                <th className="px-3 py-2 font-medium">Cuándo</th>
                <th className="px-3 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((i) => {
                const v = reviewRowView(i);
                return (
                  <ClickableTr key={i.id} className="hover:bg-accent/40" onOpen={() => setOpen(i)}>
                    <td className="px-3 py-2">{i.contactName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{v.kindLabel}</td>
                    <td className="px-3 py-2">
                      {i.formName}
                      {i.attempt && i.attempt > 1 ? <span className="ml-1 text-xs text-muted-foreground">(intento {i.attempt})</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{i.productName}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmt(i.createdAt)}</td>
                    <td className={cn("px-3 py-2", TONE[v.tone])}>
                      {v.stateLabel}
                      {v.gradeLabel ? ` · ${v.gradeLabel}` : ""}
                    </td>
                  </ClickableTr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && <ReviewDrawer item={open} history={items} timeZone={timeZone} canReview={canReview} onClose={() => setOpen(null)} onDone={() => { setOpen(null); router.refresh(); }} />}
    </div>
  );
}

/**
 * El drawer de una entrega. `history` son las entregas que ya están cargadas (las de la lista o las de la ficha): con
 * ellas se muestra el historial de esa persona en esa actividad (F126). Con límites, solo la última se puede revisar.
 */
export function ReviewDrawer({ item, history = [], timeZone, canReview, onClose, onDone }: { item: ReviewItem; history?: ReviewItem[]; timeZone: string; canReview: boolean; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState(item.reviewComment ?? "");
  const [note, setNote] = useState(item.internalNote ?? "");
  const scale = item.grading?.enabled ? item.grading.scale ?? "pass" : null;
  const [value, setValue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const all = history.some((h) => h.id === item.id) ? history : [...history, item];
  const mine = item.formType === "activity" ? submissionHistory(all, item) : [];
  const latest = !item.limitsConfigured || isLatestSubmission(all, item);
  const editable = canReview && item.formType === "activity" && latest && item.reviewStatus !== "superseded";
  // Esc cierra el drawer primero (está encima de la ficha del servicio o de Por revisar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  function submit(status: "reviewed" | "needs_changes") {
    setError(null);
    let v: unknown = undefined;
    if (status === "reviewed" && scale) {
      if (!value) return setError("Elegí la calificación");
      v = scale === "pass" || scale === "words" ? value : Number(value);
    }
    start(async () => {
      const res = await reviewSubmission(item.id, { status, value: v, comment, internalNote: note });
      if (!res.ok) return setError(res.error.message);
      onDone();
    });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Entrega de ${item.contactName}`} className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="h-full w-full max-w-lg space-y-4 overflow-y-auto border-l border-border bg-background p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{item.formName}</h3>
            <p className="text-xs text-muted-foreground">
              {item.contactName} · {item.productName}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-accent">
            Cerrar
          </button>
        </div>
        <dl className="space-y-3">
          {item.fields.map((f) => {
            const a = item.answers[f.key];
            const stars = f.type === "rating" ? ratingAnswerLabel(a) : null;
            return (
              <div key={f.key}>
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd className="whitespace-pre-wrap text-sm">
                  {stars ? (
                    <span aria-label={`${a} de 5 estrellas`}>{stars}</span>
                  ) : filesOfAnswers({ [f.key]: a }).length ? (
                    <SubmissionFiles submissionId={item.id} files={filesOfAnswers({ [f.key]: a })} />
                  ) : Array.isArray(a) ? (
                    a.join(", ")
                  ) : a == null || a === "" ? (
                    "—"
                  ) : typeof a === "object" ? (
                    "Archivo adjunto"
                  ) : (
                    String(a)
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
        {mine.length > 1 && (
          <div className="space-y-1 border-t border-border pt-3">
            <h4 className="text-xs font-semibold text-muted-foreground">Entregas de {item.contactName} en esta actividad</h4>
            <ol className="space-y-1 text-sm">
              {mine.map((h, n) => {
                const v = reviewRowView(h);
                const g = gradeLabel(h.grade);
                return (
                  <li key={h.id} className={cn("flex items-center justify-between gap-2", h.id === item.id && "font-medium")}>
                    <span>
                      Entrega {n + 1} · {new Date(h.createdAt).toLocaleDateString("es-AR", { timeZone, day: "2-digit", month: "2-digit" })}
                      {h.id === item.id ? " (esta)" : ""}
                    </span>
                    <span className={TONE[v.tone]}>
                      {v.stateLabel}
                      {g ? ` · ${g}` : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        {item.formType === "activity" && canReview && !editable && (
          <p className="text-sm text-muted-foreground">{item.reviewStatus === "superseded" ? "La reemplazó una entrega más nueva." : "Hay una entrega más nueva: se revisa esa."}</p>
        )}
        {item.formType === "quiz" && <p className="text-sm text-muted-foreground">La corrigió el sistema: {reviewRowView(item).stateLabel}{reviewRowView(item).gradeLabel ? ` · ${reviewRowView(item).gradeLabel}` : ""}.</p>}
        {editable && (
          <div className="space-y-3 border-t border-border pt-3">
            {scale && (
              <label className="block text-xs text-muted-foreground">
                Calificación ({SCALE_LABELS[scale as keyof typeof SCALE_LABELS] ?? scale})
                <select className={fieldInput} value={value} onChange={(e) => setValue(e.target.value)}>
                  <option value="">Elegí</option>
                  {scale === "pass" && (
                    <>
                      <option value="approved">Aprobada</option>
                      <option value="not_approved">No aprobada</option>
                    </>
                  )}
                  {scale === "words" && WORD_SCALE.map((w) => <option key={w} value={w}>{WORD_LABELS[w]}</option>)}
                  {(scale === "stars" || scale === "n10" || scale === "n100") &&
                    Array.from({ length: scale === "stars" ? 5 : scale === "n10" ? 10 : 100 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            <label className="block text-xs text-muted-foreground">
              Comentario para el estudiante
              <textarea className={fieldInput} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
            <label className="block text-xs text-muted-foreground">
              Nota interna (solo el equipo)
              <textarea className={fieldInput} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => submit("needs_changes")} disabled={pending} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
                Pedir otra entrega
              </button>
              <button type="button" onClick={() => submit("reviewed")} disabled={pending} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {scale ? "Guardar calificación" : "Revisada"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Los archivos de una entrega (00392): cada uno se abre con un link de 60 segundos que comprueba que es de esta entrega. */
function SubmissionFiles({ submissionId, files }: { submissionId: string; files: { path: string; name: string; size: number }[] }) {
  const [error, setError] = useState<string | null>(null);
  const open = async (path: string) => {
    setError(null);
    const r = await submissionFileUrl(submissionId, path);
    if (!r.ok) return setError(r.error.message);
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  };
  return (
    <span className="flex flex-col items-start gap-1">
      {files.map((f) => (
        <button key={f.path} type="button" onClick={() => open(f.path)} className="text-left text-primary underline-offset-2 hover:underline">
          {f.name} <span className="text-xs text-muted-foreground">({Math.max(1, Math.round(f.size / 1024))} KB)</span>
        </button>
      ))}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
