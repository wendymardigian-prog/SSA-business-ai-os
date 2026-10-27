"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Trash2, Zap, MessageSquare, GitBranch, Clock, Cog, Sparkles, Split, UserRoundPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Edge, Node } from "@xyflow/react";

import { TriggerPanel } from "./TriggerPanel";
import { SendMessagePanel } from "./SendMessagePanel";
import type { AttributionDefaults } from "@/lib/attribution/panel-view";
import { ConditionPanel } from "./ConditionPanel";
import { DelayPanel } from "./DelayPanel";
import { ActionPanel } from "./ActionPanel";
import { AiResponsePanel } from "./AiResponsePanel";
import { BranchPanel } from "./BranchPanel";
import { UpsertContactPanel } from "./UpsertContactPanel"; // @plantilla-quitar(webhooks)
import { canonicalNodeType } from "@/lib/flow-engine/node-outputs";
import { flowSendsMessages } from "@/lib/webhooks/once-per-contact"; // @plantilla-quitar(webhooks)
import { getConditionCatalogInputs } from "@/lib/actions/flow-conditions";
import { chosenType } from "@/lib/flow-engine/trigger-catalog";
import { pickerVariables } from "@/lib/flow-engine/variable-catalog";
import { actionLabel } from "../nodes/action-node";

interface NodeConfigSidebarProps {
  /** El flujo que se edita (el panel de Condiciones le pide al servidor los campos comparables). */
  flowId: string;
  /** El nombre del flujo tal como se está editando (el ejemplo de atribución lo usa). */
  flowName?: string;
  /** Los valores por defecto de atribución del negocio. */
  attributionDefaults?: AttributionDefaults;
  node: Node;
  nodes: Node[];
  edges: Edge[];
  onChange: (nodeId: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
  /** "Convertir a Condiciones" en un nodo `condition`. */
  onConvert?: (nodeId: string) => void;
  /** Abre el selector de disparador. */
  onChangeTrigger?: () => void;
}

// BFS backwards over edges; the visited set makes cycles terminate.
function getUpstreamNodeIds(nodeId: string, edges: Edge[]): Set<string> {
  const upstream = new Set<string>();
  const queue = [nodeId];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const edge of edges) {
      if (edge.target !== current || upstream.has(edge.source)) continue;
      upstream.add(edge.source);
      queue.push(edge.source);
    }
  }
  return upstream;
}

/**
 * Las variables que ofrece el selector en este paso: las del disparador (las fijas y las que manda el servidor), las
 * de los pasos ANTERIORES y las del contacto y el negocio (lib/flow-engine/variable-catalog.ts).
 */
function getFlowVariables({ node, nodes, edges, schemaPaths }: { node: Node; nodes: Node[]; edges: Edge[]; schemaPaths: string[] }): string[] {
  const triggerNode = nodes.find((n) => n.type === "trigger");
  const triggerType = chosenType((triggerNode?.data ?? {}) as Record<string, unknown>);

  // Lo que escriben los pasos que corren ANTES que este.
  const upstreamIds = getUpstreamNodeIds(node.id, edges);
  const upstreamOutputs: string[] = [];
  let contactBefore = false;
  for (const n of nodes) {
    if (!upstreamIds.has(n.id)) continue;
    const kind = canonicalNodeType({ type: n.type ?? "", data: n.data });
    if (kind === "aiResponse") upstreamOutputs.push("ai_response");
    if (kind === "upsert_contact") {
      contactBefore = true;
      upstreamOutputs.push("contact_result", "contact_fail_reason");
    }
    // El canvas guarda el HTTP Request como `type: "action"` con el tipo real en `data.actionType`.
    if (kind === "httpRequest") {
      const responseVariable = String((n.data as Record<string, unknown>).responseVariable ?? "").trim();
      if (responseVariable) upstreamOutputs.push(responseVariable, `${responseVariable}_status`, `${responseVariable}_ok`);
    }
  }

  return pickerVariables({ triggerType, schemaPaths, upstreamOutputs, contactBefore });
}

/** Las rutas del esquema del disparador (las preguntas de un formulario, los datos de la reunion…), del servidor. */
function useTriggerSchemaPaths(flowId: string, triggerData: Record<string, unknown> | undefined): string[] {
  const [paths, setPaths] = useState<string[]>([]);
  const key = JSON.stringify(triggerData ?? {});
  useEffect(() => {
    let alive = true;
    getConditionCatalogInputs({ flowId, triggerData: JSON.parse(key) as Record<string, unknown> })
      .then((res) => {
        if (alive) setPaths(res.ok ? res.inputs.triggerSchema.map((f) => f.path) : []);
      })
      .catch(() => {
        if (alive) setPaths([]);
      });
    return () => {
      alive = false;
    };
  }, [flowId, key]);
  return paths;
}

const nodeTypeConfig: Record<string, { label: string; icon: typeof Cog; color: string; borderColor: string }> = {
  trigger: {
    label: "Disparador",
    icon: Zap,
    color: "bg-emerald-500",
    borderColor: "border-emerald-500",
  },
  sendMessage: {
    label: "Enviar mensaje",
    icon: MessageSquare,
    color: "bg-blue-500",
    borderColor: "border-blue-500",
  },
  condition: {
    label: "Condición (sí / si no)",
    icon: GitBranch,
    color: "bg-amber-500",
    borderColor: "border-amber-500",
  },
  branch: {
    label: "Condiciones",
    icon: Split,
    color: "bg-indigo-500",
    borderColor: "border-indigo-500",
  },
  // @plantilla-desde(webhooks)
  upsert_contact: {
    label: "Crear o actualizar contacto",
    icon: UserRoundPlus,
    color: "bg-teal-600",
    borderColor: "border-teal-500",
  },
  // @plantilla-hasta(webhooks)
  delay: {
    label: "Esperar",
    icon: Clock,
    color: "bg-purple-500",
    borderColor: "border-purple-500",
  },
  aiResponse: {
    label: "Respuesta con IA",
    icon: Sparkles,
    color: "bg-violet-500",
    borderColor: "border-violet-500",
  },
  action: {
    label: "Acción",
    icon: Cog,
    color: "bg-slate-500",
    borderColor: "border-muted-foreground",
  },
};

export function NodeConfigSidebar({ flowId, flowName, attributionDefaults, node, nodes, edges, onChange, onClose, onDelete, onConvert, onChangeTrigger }: NodeConfigSidebarProps) {
  const nodeType = node.type || "action";
  const triggerNodeData = nodes.find((n) => n.type === "trigger")?.data as Record<string, unknown> | undefined;
  const schemaPaths = useTriggerSchemaPaths(flowId, triggerNodeData);
  const variables = useMemo(() => getFlowVariables({ node, nodes, edges, schemaPaths }), [node, nodes, edges, schemaPaths]);
  const baseConfig = nodeTypeConfig[nodeType] || nodeTypeConfig.action;
  // Una accion se llama por lo que hace ("Enviar email"), no "Acción".
  const config = nodeType === "action" ? { ...baseConfig, label: actionLabel((node.data as { actionType?: string }).actionType) } : baseConfig;
  const Icon = config.icon;

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleChange = useCallback(
    (data: Record<string, unknown>) => {
      onChange(node.id, data);
    },
    [node.id, onChange]
  );

  const handleLabelChange = useCallback(
    (label: string) => {
      onChange(node.id, { ...node.data, label });
    },
    [node.id, node.data, onChange]
  );

  function renderPanel() {
    const data = node.data as Record<string, unknown>;
    const triggerData = nodes.find((n) => n.type === "trigger")?.data as Record<string, unknown> | undefined;
    switch (nodeType) {
      case "trigger":
        return <TriggerPanel data={data} onChange={handleChange} flowId={flowId} sendsMessages={flowSendsMessages(nodes)} onChangeTrigger={onChangeTrigger} />; // @plantilla-quitar(webhooks)
        // @plantilla-sin(webhooks): return <TriggerPanel data={data} onChange={handleChange} flowId={flowId} onChangeTrigger={onChangeTrigger} />;
      case "sendMessage":
        return (
          <SendMessagePanel
            key={node.id}
            data={data}
            onChange={handleChange}
            availableVariables={variables}
            attributionContext={
              attributionDefaults
                ? {
                    flowId,
                    flowName: flowName ?? "",
                    defaults: attributionDefaults,
                    triggerType: triggerData?.triggerType as string | undefined,
                    storyReply: triggerData?.storyReply === true,
                  }
                : undefined
            }
          />
        );
      case "condition":
        return <ConditionPanel data={data} onChange={handleChange} onConvert={onConvert ? () => onConvert(node.id) : undefined} />;
      case "branch":
        return <BranchPanel flowId={flowId} nodeId={node.id} data={data} nodes={nodes} edges={edges} onChange={handleChange} />;
      // @plantilla-desde(webhooks)
      case "upsert_contact":
        return <UpsertContactPanel data={data} nodes={nodes} onChange={handleChange} />;
      // @plantilla-hasta(webhooks)
      case "delay":
        return <DelayPanel data={data} onChange={handleChange} />;
      case "aiResponse":
        return <AiResponsePanel data={data} onChange={handleChange} availableVariables={variables} />;
      case "action":
        return <ActionPanel data={data} onChange={handleChange} availableVariables={variables} />;
      default:
        return (
          <p className="text-sm text-muted-foreground">
            Este paso no tiene nada para configurar.
          </p>
        );
    }
  }

  return (
    <div
      className={cn(
        "flex w-80 flex-col border-l bg-card",
        config.borderColor
      )}
      style={{ borderLeftWidth: "3px" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className={cn("rounded-md p-1.5 text-white", config.color)}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{config.label}</p>
            <p className="text-[11px] text-muted-foreground">
              ID: {node.id.slice(0, 12)}…
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* El disparador no se borra: toda automatizacion arranca por uno. Se cambia con "Cambiar disparador". */}
          {nodeType !== "trigger" && (
            <button
              type="button"
              onClick={() => onDelete(node.id)}
              className="rounded-lg p-1.5 text-muted-foreground/60 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-500"
              title="Borrar paso"
              aria-label="Borrar paso"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Node Label */}
      <div className="border-b border-border px-4 py-3">
        <label className="mb-1.5 block text-xs font-semibold text-foreground">
          Nombre del paso
        </label>
        <input
          type="text"
          value={(node.data as Record<string, unknown>).label as string || ""}
          onChange={(e) => handleLabelChange(e.target.value)}
          placeholder={config.label}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Panel Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {renderPanel()}
      </div>

    </div>
  );
}
