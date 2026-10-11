"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Lock, Quote } from "lucide-react";
import { Historial } from "@/components/historial/historial";
import { callBadgeClass, outcomeBadgeTone, type CallBadgeTone } from "@/lib/calls/badges";
import {
  buildParticipants, conversationMetrics, fmtClock, readAnalysis, type ReadAnalysis, type TLine,
} from "@/lib/calls/detail";
import { humanize } from "@/lib/calls/format";
import { typeDeciderText } from "@/lib/calls/list";
import type { CallAttendee } from "@/lib/types/database";

/**
 * Las pestañas del analisis de una llamada (F13, F14). Solo muestran: lo que
 * hay en cada una lo decide `readAnalysis` (puro, tolerante a lo que falte).
 * Las metricas de conversacion y los participantes salen de la transcripcion,
 * sin IA, y se ven aunque la llamada todavia no se haya analizado.
 */

const ROLE_LABEL = { closer: "Closer", lead: "Lead", equipo: "Equipo" } as const;

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`space-y-1.5 rounded-lg border border-border p-3 ${className}`}>
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
const Empty = ({ t = "Sin datos todavía." }: { t?: string }) => <p className="text-sm text-muted-foreground">{t}</p>;
const yn = (v: boolean | null) => (v === null ? "—" : v ? "Sí" : "No");

function Ts({ ts, onJump }: { ts: string | null; onJump?: (ts: string) => void }) {
  if (!ts) return null;
  return onJump ? (
    <button type="button" onClick={() => onJump(ts)} className="ml-1 text-[10px] tabular-nums text-primary hover:underline" title="Ir a ese momento de la transcripción">[{ts}]</button>
  ) : (
    <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">[{ts}]</span>
  );
}

function CategoryChip({ c, tone = "classification" }: { c: { category: string | null; proposed: boolean }; tone?: CallBadgeTone }) {
  if (!c.category) return null;
  return (
    <span className={`mb-1 mr-1 ${callBadgeClass(tone)}`} title={c.proposed ? "Propuesta por la IA" : undefined}>
      {c.proposed && "✨ "}{humanize(c.category)}
    </span>
  );
}

export interface TabsData {
  callId: string;
  status: string;
  analysis: unknown;
  lines: TLine[];
  attendees: CallAttendee[];
  durationSeconds: number | null;
  recorderEmail: string | null;
  closerName: string | null;
  source: string;
  callType: string | null;
  callTypeSource: string | null;
  callTypeRule: string | null;
  callTypeConfidence: number | null;
  model: string | null;
  promptVersion: number | null;
  rubricVersion: number | null;
  costUsd: number | null;
  analyzedAt: string | null;
  quotesTotal: number | null;
  quotesVerified: number | null;
  /** Nombres para el historial. */
  names: { users: Record<string, string>; agents: Record<string, string> };
  timeZone: string;
  emptyMessage: string | null;
}

export function SummaryTab({ data, onJump }: { data: TabsData; onJump: (ts: string) => void }) {
  const a = useMemo(() => readAnalysis(data.analysis), [data.analysis]);
  const metrics = useMemo(() => {
    const host = (data.recorderEmail || "").toLowerCase();
    const closer = (data.closerName || "").toLowerCase();
    return conversationMetrics(
      data.lines,
      (name, l) => (!!host && (l.speaker?.matched_calendar_invitee_email || "").toLowerCase() === host) || (!!closer && name.toLowerCase() === closer),
      data.durationSeconds,
    );
  }, [data.lines, data.recorderEmail, data.closerName, data.durationSeconds]);
  const participants = useMemo(() => buildParticipants(data.attendees ?? [], data.lines, data.recorderEmail, data.durationSeconds), [data.attendees, data.lines, data.recorderEmail, data.durationSeconds]);
  const followup = /seguim/i.test(a.result.category ?? "");

  const cards: Array<[string, string]> = [
    ["Habló el closer", metrics.closerTalkPct === null ? "—" : `${metrics.closerTalkPct}%`],
    ["Monólogo más largo", metrics.longestMonologueSec === null ? "—" : fmtClock(metrics.longestMonologueSec)],
    ["Preguntas por hora", metrics.questionsPerHour === null ? "—" : String(metrics.questionsPerHour)],
    ["Dio el precio", metrics.priceMinute === null ? "No detectado" : `min ${metrics.priceMinute}`],
  ];

  return (
    <div className="space-y-4">
      {data.emptyMessage ? <Empty t={data.emptyMessage} /> : a.empty ? <Empty t="Esta llamada todavía no tiene análisis." /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card title="Resultado y próximo paso">
            <span className={callBadgeClass(outcomeBadgeTone(a.result.category))}>{a.result.category ? humanize(a.result.category) : "Sin resultado"}</span>
            {a.result.nextStep ? <p className="text-sm">{a.result.nextStep}</p> : <Empty t="Sin próximo paso." />}
            {followup && <p className="text-xs text-muted-foreground">Agendada en la llamada: {yn(a.result.scheduledInCall)}</p>}
          </Card>
          <Card title="Momento de quiebre">
            {a.breakpoint.text ? <p className="text-sm">{a.breakpoint.text}<Ts ts={a.breakpoint.timestamp} onJump={onJump} /></p> : <Empty />}
            {a.breakpoint.suggested && <p className="text-sm text-emerald-700 dark:text-emerald-300">«{a.breakpoint.suggested}»</p>}
          </Card>
          <Card title="Dolor principal">
            <CategoryChip c={a.pain} />
            {a.pain.text ? <p className="text-sm">{a.pain.text}<Ts ts={a.pain.timestamp} onJump={onJump} /></p> : <Empty />}
            {a.pain.depth && <span className={callBadgeClass("positive")}>Profundidad: {a.pain.depth}</span>}
          </Card>
          <Card title="Deseo principal">
            <CategoryChip c={a.desire} />
            {a.desire.text ? <p className="text-sm">{a.desire.text}<Ts ts={a.desire.timestamp} onJump={onJump} /></p> : <Empty />}
          </Card>
          <Card title="Objeción principal" className="sm:col-span-2">
            <CategoryChip c={a.objection} tone="review" />
            {a.objection.said ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="block text-xs text-muted-foreground">Lo que dijo</span>{a.objection.said}<Ts ts={a.objection.timestamp} onJump={onJump} /></div>
                <div><span className="block text-xs text-muted-foreground">Lo de fondo</span>{a.objection.underlying ?? "—"}</div>
                <div><span className="block text-xs text-muted-foreground">¿Se respondió?</span>{yn(a.objection.answered)}</div>
                <div><span className="block text-xs text-muted-foreground">¿Se resolvió?</span>{yn(a.objection.resolved)}</div>
              </div>
            ) : <Empty t="Sin objeción registrada." />}
          </Card>
          <Card title="Resumen de la IA" className="sm:col-span-2">
            {a.summary ? <p className="whitespace-pre-line text-sm leading-relaxed">{a.summary}</p> : <Empty />}
          </Card>
          {a.alerts.length > 0 && (
            <Card title="Alertas" className="sm:col-span-2">
              <ul className="space-y-1 text-sm">
                {a.alerts.map((al) => (
                  <li key={al.index} className="flex items-start gap-2">
                    <span className={callBadgeClass(al.resolved ? "neutral" : "negative")}>{humanize(al.type)}</span>
                    <span className="text-muted-foreground">{al.text}{al.resolved ? " (revisada)" : ""}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {data.lines.length > 0 && (
        <section aria-labelledby="metricas-title">
          <h3 id="metricas-title" className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Métricas de conversación <Lock className="h-3 w-3" aria-hidden /> <span className="font-normal">calculadas desde la transcripción, sin IA</span>
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cards.map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border p-2">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="text-base font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          {!metrics.timesAvailable && (
            <p className="mt-1.5 text-xs text-muted-foreground">Esta transcripción no trae los tiempos de cada línea, así que no se pueden calcular el monólogo más largo, las preguntas por hora ni el minuto en que se dio el precio.</p>
          )}
        </section>
      )}

      {participants.participants.length > 0 && (
        <Card title="Participantes">
          <p className="text-xs text-muted-foreground">{participants.invited} invitados en el calendario · {participants.spoke} personas hablaron</p>
          <ul className="divide-y divide-border">
            {participants.participants.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex items-center gap-2 py-1.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{p.name} <span className={`ml-1 ${callBadgeClass(p.role === "lead" ? "info" : p.role === "closer" ? "classification" : "neutral")}`}>{ROLE_LABEL[p.role]}</span></div>
                  {p.email && <div className="truncate text-xs text-muted-foreground">{p.email}</div>}
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.spoke ? `${p.minutes} min · ${p.pct}%` : "no habló"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function CloserTab({ data, onJump }: { data: TabsData; onJump: (ts: string) => void }) {
  const a = useMemo(() => readAnalysis(data.analysis), [data.analysis]);
  const [open, setOpen] = useState<string | null>(null);
  if (data.emptyMessage) return <Empty t={data.emptyMessage} />;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Rúbrica</h3>
        {a.rubric.length === 0 ? <Empty t="La rúbrica aparece cuando la llamada se analiza." /> : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {a.rubric.map((r) => {
              const isOpen = open === r.code;
              return (
                <div key={r.code}>
                  <button type="button" onClick={() => setOpen(isOpen ? null : r.code)} aria-expanded={isOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                    <span className="flex-1 text-sm">{r.name}</span>
                    <span className="flex gap-0.5" aria-hidden>
                      {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`h-2 w-4 rounded-sm ${r.score !== null && n <= r.score ? "bg-primary" : "bg-muted"}`} />)}
                    </span>
                    <span className="w-6 text-right text-xs tabular-nums">{r.score ?? "—"}</span>
                  </button>
                  {isOpen && (
                    <div className="space-y-1.5 px-9 pb-3 text-sm">
                      {r.justification ? <p>{r.justification}</p> : <Empty t="Sin justificación." />}
                      {r.quote && <p className="flex gap-1 italic text-muted-foreground"><Quote className="mt-1 h-3 w-3 shrink-0" aria-hidden />{r.quote}<Ts ts={r.timestamp} onJump={onJump} /></p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Card title="Foco para la próxima llamada">{a.feedback.focus ? <p className="text-sm">{a.feedback.focus}</p> : <Empty />}</Card>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card title="Lo que funcionó">
          {a.feedback.worked.length ? <ul className="list-disc space-y-1 pl-4 text-sm">{a.feedback.worked.map((w, i) => <li key={i}>{w}</li>)}</ul> : <Empty />}
        </Card>
        <Card title="Qué mejorar">
          {a.feedback.improve.length ? (
            <ul className="space-y-2 text-sm">{a.feedback.improve.map((w, i) => <li key={i}>{w.text}{w.suggested && <span className="block text-emerald-700 dark:text-emerald-300">«{w.suggested}»</span>}</li>)}</ul>
          ) : <Empty />}
        </Card>
      </div>
    </div>
  );
}

export function LeadTab({ data }: { data: TabsData }) {
  const a: ReadAnalysis = useMemo(() => readAnalysis(data.analysis), [data.analysis]);
  if (data.emptyMessage) return <Empty t={data.emptyMessage} />;
  const L = a.lead;
  const fields: Array<[string, string | string[] | null]> = [
    ["Dolores", L.pains], ["Deseos", L.desires], ["Objeciones", L.objections], ["Detonante", L.trigger],
    ["Intentos previos", L.previous], ["Quién decide", L.decider], ["Cómo llegó", L.source],
  ];
  return (
    <div className="space-y-4">
      <Card title="Perfil del lead">
        {L.profile ? <p className="text-sm leading-relaxed">{L.profile}</p> : <Empty />}
        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 pt-2 text-sm">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="pt-0.5 text-xs text-muted-foreground">{k}</dt>
              <dd>{Array.isArray(v) ? (v.length ? v.join(" · ") : "—") : v ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="Tolerancia a su situación">{L.tolerance ? <p className="text-sm">{L.tolerance}</p> : <Empty />}</Card>
      <div>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Creencias</h3>
        {L.beliefs.length === 0 ? <Empty t="Las creencias aparecen cuando la llamada se analiza." /> : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {L.beliefs.map((b) => (
                <div key={b.name} className={`rounded-lg border p-2.5 text-sm ${b.unexplored ? "border-dashed text-muted-foreground" : "border-border"}`}>
                  <div className="font-medium">{b.name}</div>
                  <div className="text-xs">{b.state ?? "No explorado"}</div>
                  {b.evidence && <p className="mt-1 text-xs italic">{b.evidence}</p>}
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Las creencias «No explorado» no le bajan la nota al lead.</p>
          </>
        )}
      </div>
    </div>
  );
}

export function TechTab({ data }: { data: TabsData }) {
  const a = useMemo(() => readAnalysis(data.analysis), [data.analysis]);
  const total = data.quotesTotal ?? a.verifiedQuotes.total;
  const ok = data.quotesVerified ?? a.verifiedQuotes.ok;
  const rows: Array<[string, string]> = [
    ["Ingesta", data.source === "fathom" ? "Fathom (automática)" : "Importación manual"],
    ["Clasificación", typeDeciderText({ call_type_source: data.callTypeSource, call_type_rule: data.callTypeRule, call_type_confidence: data.callTypeConfidence }) || "—"],
    ["Modelo", data.model ?? "—"],
    ["Versión del prompt", data.promptVersion ? `v${data.promptVersion}` : data.model ? "Texto del sistema" : "—"],
    ["Versión de la rúbrica", data.rubricVersion ? `v${data.rubricVersion}` : "—"],
    ["Citas verificadas", total ? `${ok ?? 0} de ${total}` : "—"],
    ["Costo", data.costUsd === null ? "—" : `USD ${data.costUsd.toFixed(4)}`],
  ];
  return (
    <div className="space-y-4">
      <Card title="Cómo se procesó">
        <dl className="grid grid-cols-[150px_1fr] gap-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents"><dt className="pt-0.5 text-xs text-muted-foreground">{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </Card>
      <Card title="Historial de cambios">
        <Historial entityType="call" entityId={data.callId} names={data.names} timeZone={data.timeZone} />
      </Card>
    </div>
  );
}
