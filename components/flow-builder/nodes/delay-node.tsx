"use client";

import { NodeMetricsBadge } from "../metrics-context";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLocalDateTime } from "@/lib/flow-engine/wait-until";
import { useViewerTimezone } from "@/components/dashboard-chrome";

export interface DelayNodeProps {
  label?: string;
  duration?: number;
  unit?: "seconds" | "minutes" | "hours" | "days";
  /** Fecha ISO: si esta, el paso espera hasta ese momento en vez de una duracion. */
  waitUntil?: string;
  /** Lo mismo en la hora del negocio (`AAAA-MM-DDTHH:mm`). Gana sobre `waitUntil`. */
  waitUntilLocal?: string;
}

/** Las unidades en castellano, en singular y en plural. */
const UNIT_LABELS: Record<string, [string, string]> = {
  seconds: ["segundo", "segundos"],
  minutes: ["minuto", "minutos"],
  hours: ["hora", "horas"],
  days: ["día", "días"],
};

/** Un nodo viejo guarda un instante: se muestra en la zona de quien mira. */
function formatWaitUntil(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

export function DelayNode({ id, data, selected }: NodeProps) {
  const timeZone = useViewerTimezone();
  const nodeData = data as DelayNodeProps;
  const label = nodeData.label || "Esperar";
  const duration = nodeData.duration || 0;
  const unit = nodeData.unit || "minutes";

  const unitLabels = UNIT_LABELS[unit];
  const unitText = unitLabels ? (duration === 1 ? unitLabels[0] : unitLabels[1]) : unit;
  const waitUntilText = nodeData.waitUntilLocal
    ? formatLocalDateTime(nodeData.waitUntilLocal)
    : nodeData.waitUntil
      ? formatWaitUntil(nodeData.waitUntil, timeZone)
      : null;
  const configured = waitUntilText !== null || duration > 0;

  const displayDuration = waitUntilText
    ? `Hasta el ${waitUntilText}`
    : duration > 0
      ? `${duration} ${unitText}`
      : "Sin configurar";

  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card shadow-sm transition-shadow",
        selected ? "border-purple-500 shadow-md" : "border-border"
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !border-2 !border-purple-500 !bg-white"
      />
      <div className="flex items-center gap-2 rounded-t-lg bg-purple-500 px-3 py-2 text-white">
        <Clock className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">Esperar</span>
        <div className="ml-auto shrink-0">
          <NodeMetricsBadge nodeId={id} data={data as Record<string, unknown>} />
        </div>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium">{label}</p>
        <p
          className={cn(
            "mt-1 text-xs",
            configured ? "text-muted-foreground" : "text-muted-foreground italic"
          )}
        >
          {displayDuration}
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-3 !w-3 !border-2 !border-purple-500 !bg-white"
      />
    </div>
  );
}
