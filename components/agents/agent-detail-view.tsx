"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { setAgentEnabled } from "@/lib/actions/agents";
import type { AgentTypeDefinition } from "@/lib/agent/agent-types";
import type { AgentScreenData } from "@/lib/agent/screen";
import { ConfigTab } from "./config-tab";
import { KnowledgeTab } from "./knowledge-tab";
import { ChannelsTab } from "./channels-tab";
import { ToolsTab } from "./tools-tab";

/**
 * Detalle de un agente. Las pestanas salen del registro de tipos: la vista no
 * sabe de que tipo es el agente, solo muestra lo que el tipo declara.
 */

const TAB_CONTENT: Record<string, (props: { data: AgentScreenData; typeDef: AgentTypeDefinition }) => React.ReactNode> = {
  config: (p) => <ConfigTab {...p} />,
  tools: (p) => <ToolsTab {...p} />,
  knowledge: (p) => <KnowledgeTab {...p} />,
  channels: (p) => <ChannelsTab {...p} />,
};

export function AgentDetailView({
  data,
  typeDef,
  tab,
}: {
  data: AgentScreenData;
  typeDef: AgentTypeDefinition;
  tab: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { agent } = data;

  const providerConnected = data.providers.some((p) => p.provider === agent.provider);
  const modelLabel = agent.model
    ? `${data.providerLabels[agent.provider ?? ""] ?? agent.provider} / ${agent.model}`
    : "Sin modelo elegido";

  function toggleEnabled(next: boolean) {
    setError(null);
    start(async () => {
      const result = await setAgentEnabled(agent.id, next);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  const content = TAB_CONTENT[tab];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 pt-6">
        <Link href="/dashboard/agents" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Agentes
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{agent.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {typeDef.label} · {modelLabel}
              {agent.model && !providerConnected && (
                <span className="ml-2 font-medium text-red-600 dark:text-red-400">(proveedor no conectado)</span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-3">
              <span className={cn("text-sm font-medium", agent.isEnabled ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                {agent.isEnabled ? "Encendido" : "Apagado"}
              </span>
              <Switch checked={agent.isEnabled} disabled={pending} onChange={toggleEnabled} label="Encendido global del agente" />
            </div>
            {agent.isEnabled && agent.enabledChannelIds.length === 0 && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">Encendido, pero no atiende ningún canal todavía.</p>
            )}
            {error && (
              <p role="alert" className="max-w-xs text-right text-xs text-red-700 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
        </div>

        <nav className="mt-5 flex gap-1 overflow-x-auto" aria-label="Secciones del agente">
          {typeDef.tabs.map((t) =>
            t.available ? (
              <Link
                key={t.key}
                href={`/dashboard/agents/${agent.id}?tab=${t.key}`}
                aria-current={tab === t.key ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 pb-3 text-sm font-medium transition-colors",
                  tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ) : (
              <span
                key={t.key}
                title="Llega en el Bloque 2b"
                className="cursor-not-allowed whitespace-nowrap border-b-2 border-transparent px-3 pb-3 text-sm text-muted-foreground/50"
              >
                {t.label} <span className="text-[10px]">· próximamente</span>
              </span>
            ),
          )}
        </nav>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-6">{content ? content({ data, typeDef }) : null}</div>
      </div>
    </div>
  );
}
