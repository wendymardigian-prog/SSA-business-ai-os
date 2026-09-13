"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { PlatformIcon } from "@/components/platform-icon";
import { setAgentChannel } from "@/lib/actions/agents";
import type { AgentScreenData } from "@/lib/agent/screen";
import type { Platform } from "@/lib/platforms";
import { Notice, Section } from "./fields";

/**
 * Pestana Canales (F30): el interruptor maestro por canal. Con el maestro
 * apagado, el agente nunca responde en ese canal y el toggle de las
 * conversaciones queda bloqueado en off.
 *
 * Tambien muestra los flows que capturan todos los mensajes: con la
 * automatizacion primero, un trigger por defecto sin la puerta "solo si el
 * agente esta apagado" deja al agente sin nada que responder.
 */
export function ChannelsTab({ data }: { data: AgentScreenData }) {
  const router = useRouter();
  const { agent, channels, flowsCapturingAll } = data;
  const [pendingChannel, setPendingChannel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function toggle(channelId: string, next: boolean) {
    setError(null);
    setPendingChannel(channelId);
    start(async () => {
      const result = await setAgentChannel(agent.id, channelId, next);
      setPendingChannel(null);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  const zernioOn = channels.some((c) => agent.enabledChannelIds.includes(c.id) && c.platform !== "whatsapp");

  return (
    <>
      {!data.persistZernioInbound && zernioOn && (
        <Notice tone="error">
          El guardado de mensajes entrantes de Instagram está apagado en{" "}
          <Link href="/dashboard/settings" className="underline underline-offset-2">Ajustes</Link>. El agente lee la
          conversación de la base: con el guardado apagado no puede responder en Instagram.
        </Notice>
      )}
      {flowsCapturingAll.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="text-amber-900 dark:text-amber-200">
            <p className="font-medium">Estos flows publicados están capturando todos los mensajes</p>
            <p className="mt-1 text-amber-800 dark:text-amber-300">
              Tienen un trigger por defecto y las automatizaciones van primero, así que el agente nunca contestaría en esas
              conversaciones. Abrí el trigger y marcá <em>Solo si el agente de IA está apagado</em>.
            </p>
            <ul className="mt-2 list-disc pl-5">
              {flowsCapturingAll.map((flow) => (
                <li key={flow.id}>
                  <Link href={`/dashboard/flows/${flow.id}`} className="underline underline-offset-2">
                    {flow.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Section title="Canales que atiende" description="El agente responde solo en los canales encendidos, y en cada conversación solo si su interruptor en la bandeja también está encendido.">
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay canales conectados. <Link href="/dashboard/channels" className="underline underline-offset-2">Conectar un canal</Link>
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {channels.map((channel) => {
              const on = agent.enabledChannelIds.includes(channel.id);
              const blockedByOther = !on && channel.takenBy !== null;
              return (
                <li key={channel.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <PlatformIcon platform={channel.platform as Platform} className="h-5 w-5" size={20} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {channel.label}
                        {channel.handle && <span className="ml-1 text-muted-foreground">{channel.handle}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {!channel.isActive
                          ? "Canal desconectado"
                          : blockedByOther
                            ? `Lo atiende "${channel.takenBy}"`
                            : on
                              ? "El agente atiende este canal"
                              : "El agente no atiende este canal"}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={on}
                    disabled={pendingChannel === channel.id || blockedByOther}
                    onChange={(next) => toggle(channel.id, next)}
                    label={`Agente en ${channel.label}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {!agent.isEnabled && agent.enabledChannelIds.length > 0 && (
          <Notice tone="info">El agente está apagado: aunque tenga canales encendidos, no responde hasta que lo enciendas arriba.</Notice>
        )}
      </Section>
    </>
  );
}
