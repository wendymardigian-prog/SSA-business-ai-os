"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Tag,
  FileText,
  Globe,
  ArrowRightLeft,
  UserCheck,
  Bell,
  Shuffle,
  Hourglass,
  Cog,
  PauseCircle,
  PlayCircle,
  Library,
  ListTodo,
  ListChecks,
  Mail,
  Smartphone,
  ListOrdered,
  CalendarX,
  CalendarCheck,
  BadgeDollarSign,
  CalendarClock,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeType } from "@/lib/types/database";
import { NodeBlockedNotice } from "../capabilities-context";

export interface ActionNodeProps {
  label?: string;
  actionType?: NodeType;
  tagName?: string;
  action?: "add" | "remove";
  fieldSlug?: string;
  value?: string;
  method?: string;
  url?: string;
  flowId?: string;
  message?: string;
  paths?: Array<{ name: string; weight: number }>;
  timeout?: number;
  timeoutUnit?: string;
  /** "Enviar recurso": el recurso elegido y su nombre (para mostrarlo sin leer la banca). */
  assetId?: string;
  assetName?: string;
  /** "Crear tarea": el titulo (con variables) que se muestra como resumen. */
  title?: string;
  /** "Crear tarea": quien queda a cargo y la clave de origen, que se muestran en la tarjeta. */
  owner?: string;
  sourceKey?: string;
  /** "Completar tarea": la clave de origen de la(s) tarea(s) que cierra. */
  /** "Enviar email" y "Enviar WhatsApp a un número": a quién va, que se muestra en la tarjeta. */
  to?: string;
  fixedEmail?: string;
  toVariable?: string;
  fixedPhone?: string;
  channelId?: string;
  text?: string;
  subject?: string;
}

const actionConfig: Record<
  string,
  { icon: typeof Cog; label: string; color: string }
> = {
  addTag: {
    icon: Tag,
    label: "Agregar etiqueta",
    color: "bg-gray-500",
  },
  removeTag: {
    icon: Tag,
    label: "Quitar etiqueta",
    color: "bg-gray-500",
  },
  setCustomField: {
    icon: FileText,
    label: "Definir campo",
    color: "bg-gray-500",
  },
  httpRequest: {
    icon: Globe,
    label: "Llamada HTTP",
    color: "bg-gray-500",
  },
  goToFlow: {
    icon: ArrowRightLeft,
    label: "Ir a otra automatización",
    color: "bg-gray-500",
  },
  humanTakeover: {
    icon: UserCheck,
    label: "Derivar a una persona",
    color: "bg-gray-500",
  },
  subscribe: {
    icon: Bell,
    label: "Suscribir",
    color: "bg-gray-500",
  },
  unsubscribe: {
    icon: Bell,
    label: "Desuscribir",
    color: "bg-gray-500",
  },
  commentReply: {
    icon: Cog,
    label: "Responder el comentario",
    color: "bg-gray-500",
  },
  privateReply: {
    icon: Cog,
    label: "Responder por privado",
    color: "bg-gray-500",
  },
  abSplit: {
    icon: Shuffle,
    label: "A/B split",
    color: "bg-gray-500",
  },
  smartDelay: {
    icon: Hourglass,
    label: "Esperar respuesta",
    color: "bg-gray-500",
  },
  pauseAgent: {
    icon: PauseCircle,
    label: "Pausar agente IA",
    color: "bg-gray-500",
  },
  resumeAgent: {
    icon: PlayCircle,
    label: "Reanudar agente IA",
    color: "bg-gray-500",
  },
  sendAsset: {
    icon: Library,
    label: "Enviar recurso",
    color: "bg-gray-500",
  },
  create_task: {
    icon: ListTodo,
    label: "Crear tarea",
    color: "bg-gray-500",
  },
  complete_task: {
    icon: ListChecks,
    label: "Completar tarea",
    color: "bg-gray-500",
  },
  send_email: {
    icon: Mail,
    label: "Enviar email",
    color: "bg-gray-500",
  },
  send_whatsapp_number: {
    icon: Smartphone,
    label: "Enviar WhatsApp a un número",
    color: "bg-gray-500",
  },
  enrollSequence: { icon: ListOrdered, label: "Inscribir en secuencia", color: "bg-gray-500" },
  notify_team: { icon: Bell, label: "Avisar en la campana", color: "bg-gray-500" },
  cancel_booking: { icon: CalendarX, label: "Cancelar la reunión", color: "bg-gray-500" },
  set_booking_status: { icon: CalendarCheck, label: "Cambiar estado de la reunión", color: "bg-gray-500" },
  mark_payment_paid: { icon: BadgeDollarSign, label: "Marcar pago como cobrado", color: "bg-gray-500" },
  reschedule_payment: { icon: CalendarClock, label: "Reprogramar pago", color: "bg-gray-500" },
  set_sale_status: { icon: Ban, label: "Cancelar la venta", color: "bg-gray-500" },
};

/** El nombre de cada accion (lo usan el nodo y el encabezado del panel lateral). */
export function actionLabel(actionType: string | undefined): string {
  return (actionType && actionConfig[actionType]?.label) || "Acción";
}

const UNIT_LABELS: Record<string, [string, string]> = { minutes: ["minuto", "minutos"], hours: ["hora", "horas"], days: ["día", "días"] };

const OWNER_LABELS: Record<string, string> = {
  user: "Una persona",
  member: "Quien envió el reporte",
  seller: "Vendedor de la venta",
  contact_assigned: "Asignada al contacto",
};

/** La segunda linea de la tarjeta de «Crear tarea»: quien queda a cargo y la clave de origen. */
function getDetail(nodeData: ActionNodeProps): string | null {
  if (nodeData.actionType !== ("create_task" as NodeType)) return null;
  const parts = [nodeData.owner && OWNER_LABELS[nodeData.owner] ? `A cargo: ${OWNER_LABELS[nodeData.owner]}` : null, nodeData.sourceKey?.trim() ? `Clave: ${nodeData.sourceKey.trim()}` : null];
  return parts.filter(Boolean).join(" · ") || null;
}

function getSummary(nodeData: ActionNodeProps): string | null {
  const type = nodeData.actionType;
  if (!type) return null;

  switch (type) {
    case "addTag":
      return nodeData.tagName ? `Agrega «${nodeData.tagName}»` : null;
    case "removeTag":
      return nodeData.tagName ? `Quita «${nodeData.tagName}»` : null;
    case "setCustomField":
      return nodeData.fieldSlug
        ? `${nodeData.fieldSlug} = ${nodeData.value || "..."}`
        : null;
    case "httpRequest":
      return nodeData.url
        ? `${nodeData.method || "GET"} ${nodeData.url}`
        : null;
    case "goToFlow":
      return nodeData.flowId ? "Automatización elegida" : null;
    case "humanTakeover":
      return nodeData.message || "Pasa a una persona del equipo";
    case "subscribe":
      return "Suscribe al contacto";
    case "unsubscribe":
      return "Desuscribe al contacto";
    case "abSplit":
      if (nodeData.paths && nodeData.paths.length > 0) {
        return nodeData.paths.map((p) => `${p.name}: ${p.weight}%`).join(", ");
      }
      return null;
    case "smartDelay": {
      const enabled = typeof (nodeData as { timeoutEnabled?: unknown }).timeoutEnabled === "boolean" ? (nodeData as { timeoutEnabled?: boolean }).timeoutEnabled : nodeData.timeout != null;
      if (!enabled || !nodeData.timeout) return "Hasta que responda (máx. 7 días)";
      const [one, many] = UNIT_LABELS[nodeData.timeoutUnit || "minutes"] ?? UNIT_LABELS.minutes;
      return `Hasta ${nodeData.timeout} ${nodeData.timeout === 1 ? one : many}`;
    }
    case "sendAsset":
      return nodeData.assetId ? (nodeData.assetName ?? "Recurso elegido") : null;
    case "create_task" as NodeType:
      return nodeData.title?.trim() || null;
    case "complete_task" as NodeType:
      return nodeData.sourceKey?.trim() ? `Clave: ${nodeData.sourceKey.trim()}` : null;
    // Tirón 2, D3/D4: a quién va, en una línea.
    case "send_whatsapp_number" as NodeType: {
      if (nodeData.to === "variable") return nodeData.toVariable?.trim() ? `A ${nodeData.toVariable.trim()}` : null;
      return nodeData.fixedPhone?.trim() ? `A ${nodeData.fixedPhone.trim()}` : null;
    }
    case "send_email" as NodeType: {
      if (nodeData.to === "variable") return nodeData.toVariable?.trim() ? `A ${nodeData.toVariable.trim()}` : null;
      if (nodeData.to === "fixed") return nodeData.fixedEmail?.trim() ? `A ${nodeData.fixedEmail.trim()}` : null;
      return nodeData.subject?.trim() || "Al contacto";
    }
    default:
      return null;
  }
}

export function ActionNode({ data, selected }: NodeProps) {
  const nodeData = data as ActionNodeProps;
  const actionType = nodeData.actionType || "addTag";
  const config = actionConfig[actionType] || {
    icon: Cog,
    label: "Acción",
    color: "bg-gray-500",
  };
  const Icon = config.icon;
  const label = nodeData.label || config.label;
  const summary = getSummary(nodeData);
  const detail = getDetail(nodeData);

  const isAbSplit = actionType === "abSplit";
  const paths = isAbSplit ? nodeData.paths || [] : [];
  // «Esperar respuesta» con tiempo maximo: dos salidas, «Respondió» (la de siempre) y «No respondió» (`timeout`).
  const nd = nodeData as ActionNodeProps & { timeoutEnabled?: boolean };
  const hasTimeoutExit = actionType === "smartDelay" && (typeof nd.timeoutEnabled === "boolean" ? nd.timeoutEnabled : nd.timeout != null);

  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card shadow-sm transition-shadow",
        selected ? "border-gray-400 shadow-md" : "border-border"
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !border-2 !border-gray-400 !bg-white"
      />
      <div
        className={cn(
          "flex items-center gap-2 rounded-t-lg px-3 py-2 text-white",
          config.color
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">{config.label}</span>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium">{label}</p>
        {summary ? (
          <p className="mt-1 truncate text-xs text-muted-foreground">{summary}</p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground italic">Sin configurar</p>
        )}
        {detail && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</p>}
      </div>
      <NodeBlockedNotice node={{ type: "action", data: { actionType } }} />
      {isAbSplit && paths.length > 0 ? (
        <>
          {/* Una salida por camino, con el nombre arriba (el motor sigue la salida `split-N`). */}
          <div className="flex justify-around px-2 pb-1 text-[10px] text-muted-foreground">
            {paths.map((path, i) => (
              <span key={i}>{path.name}</span>
            ))}
          </div>
          {paths.map((path, i) => (
            <Handle
              key={i}
              type="source"
              position={Position.Bottom}
              id={`split-${i}`}
              style={{ left: `${((i + 1) / (paths.length + 1)) * 100}%` }}
              className="!h-3 !w-3 !border-2 !border-gray-400 !bg-white"
            />
          ))}
        </>
      ) : hasTimeoutExit ? (
        <>
          <div className="flex justify-between px-4 pb-1 text-[10px] text-muted-foreground">
            <span>Respondió</span>
            <span>No respondió</span>
          </div>
          <Handle type="source" position={Position.Bottom} style={{ left: "25%" }} className="!h-3 !w-3 !border-2 !border-emerald-500 !bg-white" />
          <Handle type="source" position={Position.Bottom} id="timeout" style={{ left: "75%" }} className="!h-3 !w-3 !border-2 !border-amber-500 !bg-white" />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-3 !w-3 !border-2 !border-gray-400 !bg-white"
        />
      )}
    </div>
  );
}
