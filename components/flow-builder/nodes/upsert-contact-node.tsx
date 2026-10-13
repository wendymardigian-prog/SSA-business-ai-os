"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { UserRoundPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseUpsertContactConfig } from "@/lib/webhooks/upsert-config";

/**
 * «Crear o actualizar contacto»: dos salidas, «Listo» (`ok`) y «No se pudo» (`fail`). Los pasos que
 * necesitan un contacto se conectan a «Listo»: el editor no deja publicar si falta (F10).
 */
export function UpsertContactNode({ data, selected }: NodeProps) {
  const nodeData = data as { label?: string };
  const config = parseUpsertContactConfig(data);
  const fields = config.map.length;

  return (
    <div className={cn("w-56 rounded-lg border bg-card shadow-sm transition-shadow", selected ? "border-teal-500 shadow-md" : "border-border")}>
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-teal-500 !bg-white" />
      <div className="flex items-center gap-2 rounded-t-lg bg-teal-600 px-3 py-2 text-white">
        <UserRoundPlus className="h-3.5 w-3.5" aria-hidden />
        <span className="text-xs font-semibold">Crear o actualizar contacto</span>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium">{nodeData.label || (config.mode === "update_only" ? "Actualizar contacto" : "Crear o actualizar")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{fields === 0 ? "Sin campos mapeados todavía" : `${fields} ${fields === 1 ? "campo" : "campos"} · ${config.update === "overwrite" ? "sobrescribe" : "completa lo vacío"}`}</p>
      </div>
      <div className="flex border-t border-border pb-1.5 pt-1.5">
        <span className="flex-1 text-center text-[10px] font-medium text-emerald-600">Listo</span>
        <span className="flex-1 text-center text-[10px] font-medium text-red-500">No se pudo</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="ok" style={{ left: "25%" }} className="!h-3 !w-3 !border-2 !border-emerald-500 !bg-white" />
      <Handle type="source" position={Position.Bottom} id="fail" style={{ left: "75%" }} className="!h-3 !w-3 !border-2 !border-red-500 !bg-white" />
    </div>
  );
}
