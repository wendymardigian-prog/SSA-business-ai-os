import Link from "next/link";
import { Bot, ChevronRight } from "lucide-react";
import { getAgentType } from "@/lib/agent/agent-types";
import { getProvider } from "@/lib/integrations/providers";
import type { AgentConfig } from "@/lib/agent/config";

/** La card de un agente en Agentes IA: nombre, estado, tipo, modelo y canales, con un ícono de robot. */
export function AgentCard({ agent }: { agent: AgentConfig }) {
  const typeDef = getAgentType(agent.type);
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
          <span
            className={
              agent.isEnabled
                ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            }
          >
            {agent.isEnabled ? "Encendido" : "Apagado"}
          </span>
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
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
