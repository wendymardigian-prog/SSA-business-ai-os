"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, ExternalLink, Info, Loader2, Tag, Video } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { BackToCalls } from "@/components/calls/back-link";
import { Tabs } from "@/components/ui/tabs";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { CallTranscript } from "@/components/calls/call-transcript";
import { BookingLink, ContactLink } from "@/components/calls/link-popovers";
import { CloserTab, LeadTab, SummaryTab, TechTab, type TabsData } from "@/components/calls/call-analysis-tabs";
import { OutcomeChip, SourceChip, StatusChip, TypeChip } from "@/components/calls/call-chips";
import { readAnalysis } from "@/lib/calls/detail";
import { formatCallDate, formatDuration } from "@/lib/calls/format";
import { callBadgeClass, scoreBadgeTone } from "@/lib/calls/badges";
import { typeDeciderText } from "@/lib/calls/list";
import type { DetailTab, DetailView } from "@/lib/calls/detail-view";
import { useRouter } from "next/navigation";

/**
 * La ficha de una llamada (F13). Escritorio: el analisis a la izquierda (60 %)
 * y la transcripcion a la derecha (40 %). Celular: pestañas, con la
 * transcripcion como una mas. Que muestra cada estado lo decide `detailView`.
 */

export interface CallDetailData extends TabsData {
  title: string;
  recordedAt: string;
  contact: { id: string; name: string } | null;
  booking: { id: string; startAt: string } | null;
  fathomUrl: string | null;
  shareUrl: string | null;
  statusReason: string | null;
  outcome: string | null;
  closerScore: number | null;
  leadScore: number | null;
  temperature: number | null;
  needsReview: boolean;
}

const BANNER_TONE = {
  info: "border-sky-500/30 bg-sky-500/10",
  warning: "border-amber-500/30 bg-amber-500/10",
  error: "border-red-500/30 bg-red-500/10",
  neutral: "border-border bg-muted/40",
} as const;

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

export function CallDetail({ data, view, canEdit }: { data: CallDetailData; view: DetailView; canEdit: boolean }) {
  const router = useRouter();
  const timeZone = useViewerTimezone();
  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<DetailTab | "transcripcion">("resumen");
  const jumpRef = useRef<((timestamp: string) => void) | null>(null);
  const a = readAnalysis(data.analysis);
  const quotes = a.quotes;
  const busy = data.status === "analyzing" || data.status === "classifying";

  // Mientras se clasifica o se analiza, la pantalla se actualiza sola.
  useEffect(() => {
    if (!busy) return;
    const handle = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(handle);
  }, [busy, router]);

  const tabs: Array<{ value: DetailTab | "transcripcion"; label: string }> = [
    { value: "resumen", label: "Resumen" },
    { value: "closer", label: "Closer" },
    { value: "lead", label: "Lead" },
    { value: "tecnico", label: "Técnico" },
    ...(isDesktop ? [] : [{ value: "transcripcion" as const, label: "Transcripción" }]),
  ];
  const activeTab = !isDesktop || tab !== "transcripcion" ? tab : "resumen";

  const jump = (ts: string) => {
    if (!isDesktop) setTab("transcripcion");
    setTimeout(() => jumpRef.current?.(ts), 50);
  };

  const heading = data.contact?.name ?? data.title;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/llamadas/[id]" title="Llamada" backHref={<BackToCalls />} />
      <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
        <div className="grid min-h-full gap-0 lg:h-full lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0 space-y-4 p-4 md:p-6 lg:overflow-y-auto">
            <header className="space-y-2">
              <h2 className="text-lg font-semibold">{heading}{data.contact ? <span className="font-normal text-muted-foreground"> · {data.title}</span> : null}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{formatCallDate(data.recordedAt, timeZone)}</span>
                <span>{formatDuration(data.durationSeconds)}</span>
                <span>Closer: {data.closerName ?? data.recorderEmail ?? "—"}</span>
                <SourceChip source={data.source} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span title={typeDeciderText({ call_type_source: data.callTypeSource, call_type_rule: data.callTypeRule, call_type_confidence: data.callTypeConfidence }) ?? undefined} className="inline-flex items-center gap-1">
                  <Tag className="h-3 w-3 text-muted-foreground" aria-hidden />
                  <TypeChip type={data.callType} needsReview={data.needsReview} />
                </span>
                <StatusChip status={data.status} />
                <ContactLink callId={data.callId} contact={data.contact} canEdit={canEdit} />
                <BookingLink callId={data.callId} booking={data.booking} canEdit={canEdit} />
                {data.source === "fathom" && (data.shareUrl || data.fathomUrl) && (
                  <a href={(data.shareUrl || data.fathomUrl) as string} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted">
                    <Video className="h-3 w-3" aria-hidden /> Ver en Fathom <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
              </div>
            </header>

            {view.banner && (
              <div role={view.banner.tone === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl border p-3 ${BANNER_TONE[view.banner.tone]}`}>
                {view.banner.spinner ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden /> : view.banner.tone === "error" || view.banner.tone === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{view.banner.title}</p>
                  <p className="text-muted-foreground">{view.banner.message}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-border p-2.5">
                <div className="text-[11px] text-muted-foreground">Resultado</div>
                <div className="mt-1"><OutcomeChip outcome={data.outcome} /></div>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <div className="text-[11px] text-muted-foreground">Puntaje del closer</div>
                <div className={`mt-1 inline-flex text-xl font-semibold tabular-nums ${data.closerScore === null ? "" : callBadgeClass(scoreBadgeTone(data.closerScore))}`}>{data.closerScore ?? "—"}</div>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <div className="text-[11px] text-muted-foreground">Puntaje del lead</div>
                <div className={`mt-1 inline-flex text-xl font-semibold tabular-nums ${data.leadScore === null ? "" : callBadgeClass(scoreBadgeTone(data.leadScore))}`}>{data.leadScore ?? "—"}</div>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <div className="text-[11px] text-muted-foreground">Temperatura</div>
                <div className="text-xl font-semibold tabular-nums">{data.temperature === null ? "—" : `${data.temperature}/10`}</div>
              </div>
            </div>

            <Tabs tabs={tabs} value={activeTab} onChange={setTab} label="Secciones de la llamada">
              {activeTab === "resumen" && <SummaryTab data={{ ...data, emptyMessage: view.emptyMessage }} onJump={jump} />}
              {activeTab === "closer" && <CloserTab data={{ ...data, emptyMessage: view.emptyMessage }} onJump={jump} />}
              {activeTab === "lead" && <LeadTab data={{ ...data, emptyMessage: view.emptyMessage }} />}
              {activeTab === "tecnico" && <TechTab data={data} />}
              {activeTab === "transcripcion" && <CallTranscript lines={data.lines} quotes={quotes} jumpRef={jumpRef} />}
            </Tabs>
          </div>

          {/* Solo en escritorio: en el celular la transcripcion es una pestaña (y dos montadas se pisarian el `jumpRef`). */}
          {isDesktop && (
            <aside className="min-w-0 border-l border-border lg:overflow-y-auto" aria-label="Transcripción">
              <div className="p-4 md:p-6">
                <h2 className="mb-3 text-sm font-semibold">Transcripción</h2>
                <CallTranscript lines={data.lines} quotes={quotes} jumpRef={jumpRef} />
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

