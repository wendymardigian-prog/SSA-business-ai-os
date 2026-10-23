"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MousePointerClick, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { chosenType, triggerDisplayLabel, triggerEntry } from "@/lib/flow-engine/trigger-catalog";
import { TRIGGER_GROUP_ICONS } from "../trigger-picker";

export interface TriggerNodeProps {
  label?: string;
  triggerType?: string | null;
  keywords?: Array<{ value: string; matchType: string }>;
  alsoMatchInDms?: boolean;
}

/**
 * El disparador en el lienzo. Muestra el disparador ELEGIDO (de los 34, con su nombre en español; antes solo 7 tenian
 * nombre y el resto mostraba el id crudo) o, si todavia no se eligio, una invitacion a elegirlo.
 */
export function TriggerNode({ data, selected }: NodeProps) {
  const nodeData = data as TriggerNodeProps & Record<string, unknown>;
  const type = chosenType(nodeData);
  const entry = triggerEntry(type);
  const Icon = entry ? TRIGGER_GROUP_ICONS[entry.group] : Zap;
  const keywords = Array.isArray(nodeData.keywords) ? nodeData.keywords : [];

  if (!type) {
    return (
      <div
        className={cn(
          "w-60 rounded-lg border-2 border-dashed bg-card shadow-sm transition-shadow",
          selected ? "border-emerald-500 shadow-md" : "border-emerald-400/70",
        )}
      >
        <div className="flex items-center gap-2 rounded-t-lg bg-emerald-500 px-3 py-2 text-white">
          <Zap className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold">Disparador</span>
        </div>
        <div className="flex items-center gap-2 p-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <MousePointerClick className="h-4 w-4" />
          Elegí cómo arranca
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-60 rounded-lg border bg-card shadow-sm transition-shadow", selected ? "border-emerald-500 shadow-md" : "border-border")}>
      <div className="flex items-center gap-2 rounded-t-lg bg-emerald-500 px-3 py-2 text-white">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">Disparador</span>
      </div>
      <div className="p-3">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium">{typeof nodeData.label === "string" && nodeData.label.trim() ? nodeData.label : triggerDisplayLabel(nodeData)}</p>
          {type === "comment_keyword" && nodeData.alsoMatchInDms === true && (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">También por DM</span>
          )}
        </div>
        {keywords.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Palabras:{" "}
            {keywords
              .slice(0, 3)
              .map((k) => k.value)
              .join(", ")}
            {keywords.length > 3 && ` y ${keywords.length - 3} más`}
          </p>
        ) : (
          (type === "keyword" || type === "comment_keyword") && <p className="mt-1 text-xs italic text-amber-600 dark:text-amber-400">Falta cargar las palabras clave</p>
        )}
        {typeof nodeData.label === "string" && nodeData.label.trim() && <p className="mt-0.5 text-xs text-muted-foreground">{triggerDisplayLabel(nodeData)}</p>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !border-2 !border-emerald-500 !bg-white" />
    </div>
  );
}
