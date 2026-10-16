import Link from "next/link";
import { Bot, ChevronRight } from "lucide-react";
import { getAgentType } from "@/lib/agent/agent-types";
import { getProvider } from "@/lib/integrations/providers";
import type { AgentConfig } from "@/lib/agent/config";
import { availabilityBadge, type AgentAvailability } from "@/lib/agent/availability";

/** La card de un agente en Agentes IA: nombre, estado, tipo, modelo y canales, con un ícono de robot. */
export function AgentCard({ agent, availability }: { agent: AgentConfig; availability?: AgentAvailability }) {
  const typeDef = getAgentType(agent.type);
  // Sin la disponibilidad (quien la use sin saber las IAs conectadas) se ve el estado de siempre.
  const badge = availability ? availabilityBadge(availability) : { label: agent.isEnabled ? "Encendido" : "Apagado", tone: agent.isEnabled ? ("ok" as const) : ("off" as const) };
  const BADGE_STYLE = {
    ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
    warn: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
    off: "bg-muted text-muted-foreground",
  } as const;
  return (
    <Link
      href={`/dashboard/agents/${agent.id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/40"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Bot className="h-4.5 w-4.5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{agent.name}</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${BADGE_STYLE[badge.tone]}`}>{badge.label}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {typeDef?.label ?? agent.type}
          {" · "}
          {agent.model ? `${getProvider(agent.provider ?? "")?.label ?? agent.provider} / ${agent.model}` : "Usa el modelo del negocio"}
          {/* Los canales solo dicen algo de un agente que conversa: el copywriter no atiende a nadie (E1). */}
          {typeDef?.conversational && (
            <>
              {" · "}
              {agent.enabledChannelIds.length === 0 ? "Sin canales" : `${agent.enabledChannelIds.length} canal${agent.enabledChannelIds.length === 1 ? "" : "es"}`}
            </>
          )}
        </p>
        {/* Encendido pero sin IA: se dice POR QUE no responde (la configuracion no se toca). */}
        {availability?.state === "blocked" && availability.message && (
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{availability.message}</p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
