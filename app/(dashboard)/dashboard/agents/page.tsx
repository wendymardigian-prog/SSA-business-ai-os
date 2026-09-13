import Link from "next/link";
import { Bot, ChevronRight } from "lucide-react";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { loadWorkspaceAgents } from "@/lib/agent/config";
import { getAgentType } from "@/lib/agent/agent-types";
import { getProvider } from "@/lib/integrations/providers";
import { CreateAgentButton } from "@/components/agents/create-agent-button";

/**
 * Agentes (F24, Bloque 2a): lista de agentes con su estado.
 *
 * Solo Owner/Admin: requireWorkspaceAdmin ademas de la RLS. Se lee con service
 * role detras del guard porque la fila completa incluye topes de gasto, que el
 * rol authenticated no puede leer.
 */
export default async function AgentsPage() {
  const { workspace } = await requireWorkspaceAdmin();
  const service = await createServiceClient();
  const agents = await loadWorkspaceAgents(service, workspace.id);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-bold">Agentes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Los agentes de IA que conversan con tus leads: su prompt, sus límites y los canales que atienden
        </p>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {agents.length === 0 ? (
          <div className="mx-auto max-w-lg rounded-xl border border-dashed border-border p-10 text-center">
            <Bot className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden />
            <h2 className="mt-4 text-base font-semibold">Todavía no hay un agente</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Se crea apagado y sin canales, con un prompt inicial y límites seguros. Lo encendés cuando lo hayas revisado.
            </p>
            <div className="mt-6 flex justify-center">
              <CreateAgentButton />
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {agents.map((agent) => (
              <li key={agent.id}>
                <Link
                  href={`/dashboard/agents/${agent.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0">
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
                      {getAgentType(agent.type)?.label ?? agent.type}
                      {" · "}
                      {agent.model ? `${getProvider(agent.provider ?? "")?.label ?? agent.provider} / ${agent.model}` : "Sin modelo"}
                      {" · "}
                      {agent.enabledChannelIds.length === 0
                        ? "Sin canales"
                        : `${agent.enabledChannelIds.length} canal${agent.enabledChannelIds.length === 1 ? "" : "es"}`}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
