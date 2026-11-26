"use client";

/**
 * «Agentes IA» en la barra de Grabaciones: los que clasifican, analizan y resumen las grabaciones, cómo están y un
 * enlace para editar cada uno (sus instrucciones, reglas e historial viven en Agentes IA). Lo que se muestra lo arma
 * `lib/calls/ai-agents.ts`; acá solo se dibuja.
 */
import Link from "next/link";
import { Bot, ChevronRight } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import type { CallsAiAgent } from "@/lib/calls/ai-agents";
import { cn } from "@/lib/utils";

const TONE: Record<CallsAiAgent["tone"], string> = {
  on: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  manual: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  off: "bg-muted text-disabled-foreground",
};

export function CallsAiAgentsButton({ agents }: { agents: CallsAiAgent[] }) {
  return (
    <Popover
      label="Agentes IA de Grabaciones"
      panelClassName="w-[min(22rem,calc(100vw-2rem))]"
      triggerClassName="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-accent"
      trigger={
        <>
          <Bot className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Agentes IA</span>
        </>
      }
    >
      <p className="text-xs font-semibold">Agentes IA de Grabaciones</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Quién clasifica y analiza tus grabaciones. Sus instrucciones e historial de cambios se editan en cada uno.</p>
      <ul className="mt-2 space-y-1">
        {agents.map((a) => (
          <li key={a.key}>
            <Link href={a.href} className="group flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-accent">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{a.name}</span>
                <span className="block text-xs text-muted-foreground">{a.role}</span>
                <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[a.tone])}>{a.status}</span>
              </span>
              <span className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary-ink">
                Editar <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
