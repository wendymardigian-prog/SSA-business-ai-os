"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { EmojiButton } from "@/components/ui/emoji-picker";
import { listGroupMessagesForFlowEditor, listGroupsForFlowEditor, listPollStepsForFlowEditor } from "@/lib/actions/whatsapp-group-flow-editor";
import type { EditorGroup, EditorGroupMessage, EditorPollStep } from "@/lib/whatsapp-groups/editor-types";
import { WHATSAPP_QUICK_REACTIONS } from "@/lib/channels/reactions";

type GroupTrigger = "whatsapp_group_joined" | "whatsapp_group_reaction" | "whatsapp_group_poll_vote";

const QUICK = Array.from(new Set([...WHATSAPP_QUICK_REACTIONS, "🔥"]));

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : []);

/**
 * El panel de los disparadores de grupos de WhatsApp: en qué grupos, a qué mensaje o encuesta, y con qué emoji u
 * opción. Sin elegir nada vale para cualquiera. Lo guardado en el nodo se copia tal cual a `triggers.config`
 * (`lib/whatsapp-groups/automation/trigger-config.ts` lo lee).
 */
export function WhatsappGroupTriggerPanel({ triggerType, data, onChange }: { triggerType: GroupTrigger; data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const groupIds = strings(data.group_ids);
  const messageIds = strings(data.message_ids);
  const emojis = strings(data.emojis);
  const options = strings(data.options);
  const isReaction = triggerType === "whatsapp_group_reaction";
  const isPoll = triggerType === "whatsapp_group_poll_vote";
  const scope = typeof data.message_scope === "string" ? data.message_scope : isReaction ? "business" : "any";
  const flowStep = data.flow_step && typeof data.flow_step === "object" ? (data.flow_step as { flowId?: string; nodeId?: string }) : null;

  const [groups, setGroups] = useState<EditorGroup[] | null>(null);
  const [messages, setMessages] = useState<EditorGroupMessage[] | null>(null);
  const [steps, setSteps] = useState<EditorPollStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optionText, setOptionText] = useState(options.join(", "));

  useEffect(() => {
    let alive = true;
    listGroupsForFlowEditor().then((res) => {
      if (!alive) return;
      if (res.ok) setGroups(res.groups);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  const groupKey = groupIds.join(",");
  const selectedKey = messageIds.join(",");
  useEffect(() => {
    if (scope !== "picked") return;
    let alive = true;
    listGroupMessagesForFlowEditor(groupKey ? groupKey.split(",") : [], isPoll ? "polls" : "messages", selectedKey ? selectedKey.split(",") : []).then((res) => {
      if (!alive) return;
      if (res.ok) setMessages(res.messages);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [scope, groupKey, selectedKey, isPoll]);

  useEffect(() => {
    if (!isPoll || scope !== "flow_step") return;
    let alive = true;
    listPollStepsForFlowEditor().then((res) => {
      if (!alive) return;
      if (res.ok) setSteps(res.steps);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [isPoll, scope]);

  const set = (patch: Record<string, unknown>) => {
    const next = { ...data, ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) delete next[key];
    }
    onChange(next);
  };
  const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  // Las opciones que se pueden tildar: las de las encuestas elegidas o las del paso elegido.
  const knownOptions: string[] = !isPoll
    ? []
    : scope === "picked"
      ? Array.from(new Set((messages ?? []).filter((m) => messageIds.includes(m.id)).flatMap((m) => m.options ?? [])))
      : scope === "flow_step"
        ? (steps?.find((s) => s.flowId === flowStep?.flowId && s.nodeId === flowStep?.nodeId)?.options ?? [])
        : [];

  const chosenWithoutContacts = (groups ?? []).filter((g) => groupIds.includes(g.id) && !g.saveContacts);

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-foreground">En qué grupos</legend>
        {groups === null && !error ? (
          <p className="text-[11px] text-muted-foreground">Cargando los grupos…</p>
        ) : groups && groups.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Todavía no activaste ningún grupo. Se activan en{" "}
            <Link href="/dashboard/settings/integrations/evolution" className="text-primary-ink underline">
              Ajustes → Integraciones → WhatsApp → Grupos
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-1">
            {(groups ?? []).map((g) => (
              <label key={g.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => set({ group_ids: toggleIn(groupIds, g.id), message_ids: [] })} />
                <span className="truncate">{g.subject}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">· {g.channelLabel}</span>
              </label>
            ))}
            <p className="text-[11px] text-muted-foreground">Sin elegir ninguno, vale para cualquier grupo activado.</p>
          </div>
        )}
        {chosenWithoutContacts.length > 0 && (
          <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {chosenWithoutContacts.map((g) => `«${g.subject}»`).join(", ")} no {chosenWithoutContacts.length === 1 ? "guarda" : "guardan"} contactos: solo
            dispara con personas que ya son contactos. Se cambia en la sección Grupos de WhatsApp.
          </p>
        )}
      </fieldset>

      {(isReaction || isPoll) && (
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-foreground">{isPoll ? "Qué encuesta" : "A qué mensaje"}</legend>
          <div className="space-y-1 text-sm">
            {(isReaction
              ? [
                  { value: "business", label: "Cualquier mensaje que mande el negocio" },
                  { value: "any", label: "Cualquier mensaje del grupo" },
                  { value: "picked", label: "Mensajes elegidos" },
                ]
              : [
                  { value: "any", label: "Cualquier encuesta del grupo" },
                  { value: "picked", label: "Encuestas elegidas" },
                  { value: "flow_step", label: "Las que manda un paso «Enviar encuesta»" },
                ]
            ).map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name={`scope-${triggerType}`} checked={scope === o.value} onChange={() => set({ message_scope: o.value, message_ids: [], flow_step: undefined, options: [] })} />
                {o.label}
              </label>
            ))}
          </div>

          {scope === "picked" && (
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {messages === null ? (
                <p className="text-[11px] text-muted-foreground">Cargando…</p>
              ) : messages.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {isPoll ? "No hay encuestas en esos grupos todavía." : "No hay mensajes del negocio en esos grupos todavía."} También podés elegir uno
                  desde la bandeja: «⋯» en el mensaje → Crear automatización.
                </p>
              ) : (
                messages.map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-start gap-1.5 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={messageIds.includes(m.id)} onChange={() => set({ message_ids: toggleIn(messageIds, m.id) })} />
                    <span className="min-w-0 flex-1">{m.label}</span>
                  </label>
                ))
              )}
            </div>
          )}

          {scope === "flow_step" && (
            <select
              value={flowStep ? `${flowStep.flowId}:${flowStep.nodeId}` : ""}
              onChange={(e) => {
                const [flowId, nodeId] = e.target.value.split(":");
                set({ flow_step: flowId && nodeId ? { flowId, nodeId } : undefined, options: [] });
              }}
              className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              aria-label="Paso que manda la encuesta"
            >
              <option value="">Elegí el paso…</option>
              {(steps ?? []).map((s) => (
                <option key={`${s.flowId}:${s.nodeId}`} value={`${s.flowId}:${s.nodeId}`}>
                  {s.flowName}: {s.question || "(sin pregunta)"}
                </option>
              ))}
            </select>
          )}
        </fieldset>
      )}

      {isReaction && (
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-foreground">Con qué emoji</legend>
          <div className="flex flex-wrap items-center gap-1">
            {Array.from(new Set([...QUICK, ...emojis])).map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-pressed={emojis.includes(emoji)}
                onClick={() => set({ emojis: toggleIn(emojis, emoji) })}
                className={`rounded-md border px-1.5 py-0.5 text-base ${emojis.includes(emoji) ? "border-primary-edge bg-primary/10" : "border-border hover:bg-muted"}`}
              >
                {emoji}
              </button>
            ))}
            <EmojiButton label="Otro emoji" placement="bottom" onPick={(emoji) => set({ emojis: emojis.includes(emoji) ? emojis : [...emojis, emoji] })} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Sin elegir ninguno, cualquier emoji. Una vez por persona y mensaje (cambiar de emoji no lo repite).</p>
        </fieldset>
      )}

      {isPoll && (
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-foreground">Qué opción</legend>
          {knownOptions.length > 0 ? (
            <div className="space-y-1">
              {knownOptions.map((option) => (
                <label key={option} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={options.includes(option)} onChange={() => set({ options: toggleIn(options, option) })} />
                  {option}
                </label>
              ))}
            </div>
          ) : (
            <input
              type="text"
              value={optionText}
              onChange={(e) => {
                setOptionText(e.target.value);
                set({ options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) });
              }}
              placeholder="Lunes, Martes"
              aria-label="Opciones que disparan"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
            />
          )}
          {options.length > 0 && knownOptions.length === 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {options.map((o) => (
                <span key={o} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                  {o}
                  <button type="button" aria-label={`Quitar ${o}`} onClick={() => set({ options: options.filter((x) => x !== o) })}>
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            Sin elegir ninguna, cualquier opción (una vez por persona y encuesta). Con opciones, alcanza con que elija una; si cambia a otra de la lista,
            vuelve a disparar.
          </p>
        </fieldset>
      )}

      <p className="text-[11px] text-muted-foreground/80">
        Corre sobre el contacto y, si el flujo manda mensajes, le escribe por privado desde el mismo número del grupo.{" "}
        {triggerType === "whatsapp_group_joined" ? "Una vez por persona y grupo. " : ""}
        Variables: {"{{group.name}}"}
        {isReaction ? ", {{reaction.emoji}}, {{message.text}}" : ""}
        {isPoll ? ", {{poll.question}}, {{poll.selected}}" : ""}. Ojo: escribirle por privado a cada persona de un grupo grande puede hacer que WhatsApp
        bloquee el número.
      </p>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
