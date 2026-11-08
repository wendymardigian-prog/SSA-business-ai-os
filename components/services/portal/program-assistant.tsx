"use client";
// @plantilla-quitar(servicios)

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";
import { saveProgramSettings } from "@/lib/actions/services";
import { addTutorDocumentFromKnowledge, duplicateTutor, searchKnowledgeForTutor, setTutorMaterial, uploadTutorDocument } from "@/lib/actions/tutor";
import { ASSISTANT_DEFAULTS, type AssistantSettings } from "@/lib/program/assistant";
import { LESSON_TYPE_LABELS } from "@/lib/program/lesson";

export interface TutorKnowledge {
  lessons: Array<{ item_id: string; title: string; lesson_type: string | null; status: string; thumbnail_url: string | null; knowledge_id: string | null; knowledge_status: string | null; excluded: boolean }>;
  documents: Array<{ knowledge_id: string; title: string; status: string; excluded: boolean; filename: string | null }>;
}

export interface AssistantUsage {
  agent_id: string | null;
  money: boolean;
  students: Array<{ contact_id: string; name: string | null; spent_usd: number | null; reached: boolean; limit_usd: number | null }>;
  own_limits: Array<{ contact_id: string; name: string | null; limit_usd: number | null }>;
}

type Filter = "todo" | "clases" | "documentos" | "falta";

/**
 * Portal › programa › Asistente IA (F84-F86, F110): el tutor (prenderlo o abrirlo en Agentes, duplicarlo), sus límites
 * y créditos, el uso del mes y la base de conocimiento. Las evaluaciones nunca aparecen: las respuestas correctas no se
 * le pasan al tutor.
 */
export function ProgramAssistant({
  productId,
  tutor,
  sections,
  settings,
  rev,
  usage,
  knowledge,
  otherPrograms,
  can,
}: {
  productId: string;
  tutor: { id: string; name: string; enabled: boolean } | null;
  sections: Record<string, boolean>;
  settings: AssistantSettings;
  rev: number;
  usage: AssistantUsage | null;
  knowledge: TutorKnowledge | null;
  otherPrograms: Array<{ id: string; name: string; hasTutor: boolean }>;
  can: { manage: boolean; sections: boolean; knowledge: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const on = sections.assistant === true && !!tutor?.enabled;
  const [limits, setLimits] = useState({
    monthly: String(settings.monthly_limit_usd_per_student ?? ASSISTANT_DEFAULTS.monthly_limit_usd_per_student),
    perUsd: String(settings.credits_per_usd ?? ASSISTANT_DEFAULTS.credits_per_usd),
    name: settings.credits_name ?? ASSISTANT_DEFAULTS.credits_name,
    suggestions: (settings.suggestions ?? []).join("\n"),
  });
  const [dest, setDest] = useState("");
  const [filter, setFilter] = useState<Filter>("todo");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Array<{ id: string; title: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, done?: string) =>
    start(async () => {
      setError(null);
      setNotice(null);
      const r = await fn();
      if (!r.ok) return setError(r.error?.message ?? "No se pudo hacer");
      const d = (r as { data?: { status?: string; problems?: string[] } }).data;
      if (d?.status === "invalid") return setError((d.problems ?? []).join(". "));
      if (d?.status === "conflict") return setError("Alguien cambió el programa mientras tanto. Recargá la página.");
      if (done) setNotice(done);
      router.refresh();
    });

  useEffect(() => {
    if (!can.knowledge) return;
    const t = setTimeout(() => void searchKnowledgeForTutor(productId, q).then((r) => r.ok && setFound(r.data)), 250);
    return () => clearTimeout(t);
  }, [q, productId, can.knowledge]);

  const lessons = knowledge?.lessons ?? [];
  const docs = knowledge?.documents ?? [];
  const missing = lessons.filter((l) => l.lesson_type === "video" && !l.knowledge_id).length;
  const usd = (n: number | null) => (n === null ? "—" : `USD ${n.toFixed(2)}`);

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">{notice}</p>}

      <section aria-labelledby="tutor" className="space-y-2 rounded-xl border border-border p-4">
        <h2 id="tutor" className="text-sm font-semibold">Tutor del programa</h2>
        {on && tutor ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>{tutor.name}</span>
            <span className="rounded bg-good/15 px-1.5 text-xs">Prendido</span>
            <Link href={`/dashboard/agents/${tutor.id}`} className="text-xs text-primary-ink hover:underline">Abrir en Agentes IA</Link>
            {can.sections && (
              <button type="button" disabled={pending} onClick={() => confirm("¿Apagar el Asistente IA de este programa? El tutor queda inactivo.") && run(() => saveProgramSettings(productId, { sections: { ...sections, assistant: false } }, rev))} className="text-xs text-muted-foreground hover:underline">
                Apagarlo
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">El Asistente IA de este programa está apagado.</span>
            {(can.sections || can.manage) && (
              <button type="button" disabled={pending} onClick={() => run(() => saveProgramSettings(productId, { sections: { ...sections, assistant: true } }, rev), "Listo: el tutor del programa quedó creado.")} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
                Prenderla
              </button>
            )}
          </div>
        )}
        {tutor && can.manage && otherPrograms.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
            <select value={dest} onChange={(e) => setDest(e.target.value)} className={cn(fieldInput, "w-auto")} aria-label="Programa destino">
              <option value="">Duplicar a otro programa…</option>
              {otherPrograms.map((p) => <option key={p.id} value={p.id}>{p.name}{p.hasTutor ? " (ya tiene tutor)" : ""}</option>)}
            </select>
            <button
              type="button"
              disabled={pending || !dest}
              onClick={() => {
                const target = otherPrograms.find((p) => p.id === dest);
                if (!target) return;
                if (target.hasTutor && !confirm(`Reemplazar el tutor de ${target.name}. El anterior queda archivado.`)) return;
                run(() => duplicateTutor(tutor.id, dest, target.hasTutor), `Listo: ${target.name} tiene una copia de este tutor (sin las transcripciones).`);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              Duplicar
            </button>
          </div>
        )}
      </section>

      {can.manage && (
        <section aria-labelledby="limites" className="space-y-3 rounded-xl border border-border p-4">
          <h2 id="limites" className="text-sm font-semibold">Límites y créditos</h2>
          <p className="text-xs text-muted-foreground">El límite de un estudiante sale de su límite propio; si no tiene, del de su variante; si no, de este.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <DialogField label="Límite por estudiante por mes (USD)">
              <input type="number" min={0} max={10000} step="0.5" value={limits.monthly} onChange={(e) => setLimits({ ...limits, monthly: e.target.value })} className={fieldInput} />
            </DialogField>
            <DialogField label="Créditos por dólar">
              <input type="number" min={1} max={100000} step={1} value={limits.perUsd} onChange={(e) => setLimits({ ...limits, perUsd: e.target.value })} className={fieldInput} />
            </DialogField>
            <DialogField label="Cómo se llaman">
              <input value={limits.name} onChange={(e) => setLimits({ ...limits, name: e.target.value })} className={fieldInput} maxLength={30} />
            </DialogField>
          </div>
          <DialogField label="Preguntas sugeridas (una por línea)">
            <textarea value={limits.suggestions} onChange={(e) => setLimits({ ...limits, suggestions: e.target.value })} rows={3} className={fieldInput} />
          </DialogField>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  saveProgramSettings(
                    productId,
                    {
                      assistant: {
                        ...settings,
                        monthly_limit_usd_per_student: Number(limits.monthly),
                        credits_per_usd: Math.round(Number(limits.perUsd)),
                        credits_name: limits.name.trim() || ASSISTANT_DEFAULTS.credits_name,
                        suggestions: limits.suggestions.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10),
                      },
                    },
                    rev,
                  ),
                "Guardado.",
              )
            }
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            Guardar límites
          </button>
        </section>
      )}

      {usage && (
        <section aria-labelledby="uso" className="space-y-2 rounded-xl border border-border p-4">
          <h2 id="uso" className="text-sm font-semibold">Este mes</h2>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Estudiantes que lo usaron</dt><dd className="text-lg font-semibold">{usage.students.length}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Gasto</dt><dd className="text-lg font-semibold">{usage.money ? usd(usage.students.reduce((n, s) => n + (s.spent_usd ?? 0), 0)) : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Llegaron al límite</dt><dd className="text-lg font-semibold">{usage.students.filter((s) => s.reached).length}</dd></div>
          </dl>
          {usage.students.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {usage.students.slice(0, 20).map((s) => (
                <li key={s.contact_id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="flex-1">{s.name ?? "Sin nombre"}</span>
                  {usage.money && <span className="text-xs text-muted-foreground">{usd(s.spent_usd)} de {usd(s.limit_usd)}</span>}
                  {s.reached && <span className="rounded bg-warn/15 px-1.5 text-xs">Llegó al límite</span>}
                </li>
              ))}
            </ul>
          )}
          {usage.own_limits.length > 0 && (
            <p className="text-xs text-muted-foreground">Con límite propio: {usage.own_limits.map((o) => `${o.name ?? "Sin nombre"}${usage.money ? ` (${usd(o.limit_usd)})` : ""}`).join(", ")}</p>
          )}
        </section>
      )}

      {knowledge && (
        <section aria-labelledby="base" className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="base" className="text-sm font-semibold">Base de conocimiento</h2>
            <span className="flex-1" />
            {(["todo", "clases", "documentos", "falta"] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", filter === f ? "border-primary-edge bg-primary/10" : "border-border hover:bg-accent")}>
                {f === "todo" ? "Todo" : f === "clases" ? "Clases" : f === "documentos" ? "Documentos" : `Falta transcripción (${missing})`}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Lo que el tutor puede usar. Las evaluaciones nunca: las respuestas correctas no se le pasan. Un material que sacás no se borra.</p>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {(filter === "todo" || filter === "clases" || filter === "falta") &&
              lessons
                .filter((l) => filter !== "falta" || (l.lesson_type === "video" && !l.knowledge_id))
                .map((l) => (
                  <li key={l.item_id} className={cn("flex flex-wrap items-center gap-2 px-3 py-2", l.status !== "active" && "opacity-60")}>
                    <span className="flex-1">{l.title}</span>
                    <span className="text-xs text-muted-foreground">{LESSON_TYPE_LABELS[l.lesson_type ?? ""] ?? "Clase"}{l.status !== "active" ? " · inactiva" : ""}</span>
                    <span className="text-xs text-muted-foreground">
                      {l.knowledge_id ? (l.knowledge_status === "ready" ? (l.lesson_type === "video" ? "Transcripción cargada" : "Texto guardado") : "Procesándose") : l.lesson_type === "video" ? "Falta transcripción" : "Sin texto"}
                    </span>
                    {l.knowledge_id ? (
                      can.knowledge && (
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={!l.excluded} disabled={pending} onChange={(e) => run(() => setTutorMaterial(productId, l.knowledge_id as string, e.target.checked))} /> Lo usa el tutor
                        </label>
                      )
                    ) : (
                      l.lesson_type === "video" && <Link href={`/dashboard/portal/${productId}?tab=contenido`} className="text-xs text-primary-ink hover:underline">Subir</Link>
                    )}
                  </li>
                ))}
            {(filter === "todo" || filter === "documentos") &&
              docs.map((d) => (
                <li key={d.knowledge_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="flex-1">{d.title}</span>
                  <span className="text-xs text-muted-foreground">Documento · {d.status === "ready" ? "listo" : d.status === "pending" ? "pendiente de indexar" : d.status}</span>
                  {can.knowledge && (
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={!d.excluded} disabled={pending} onChange={(e) => run(() => setTutorMaterial(productId, d.knowledge_id, e.target.checked))} /> Lo usa el tutor
                    </label>
                  )}
                </li>
              ))}
          </ul>
          {can.knowledge && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium">+ Documento</p>
                <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="text-xs" aria-label="Documento para el tutor" />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    const f = fileRef.current?.files?.[0];
                    if (!f) return setError("Elegí el archivo");
                    const fd = new FormData();
                    fd.set("file", f);
                    run(() => uploadTutorDocument(productId, fd), "Documento subido: el tutor lo usa cuando termine de procesarse.");
                  }}
                  className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent"
                >
                  Subir
                </button>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium">Agregar desde Conocimiento</p>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscá un documento (nunca los internos)" className={fieldInput} />
                <ul className="max-h-40 overflow-auto text-xs">
                  {found.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 py-0.5">
                      <span className="flex-1 truncate">{f.title}</span>
                      <button type="button" disabled={pending} onClick={() => run(() => addTutorDocumentFromKnowledge(productId, f.id), "Agregado.")} className="text-primary-ink hover:underline">Agregar</button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
