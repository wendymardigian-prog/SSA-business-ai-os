"use client";

import {
  Zap,
  MessageSquare,
  GitBranch,
  Clock,
  Tag,
  FileText,
  Globe,
  ArrowRightLeft,
  UserCheck,
  Bell,
  Shuffle,
  Hourglass,
  Sparkles,
  ListOrdered,
  PauseCircle,
  PlayCircle,
  Mail,
  CalendarX,
  CalendarCheck,
  Library,
} from "lucide-react";
import type { DragEvent } from "react";

interface PaletteItem {
  type: string;
  nodeType: string;
  label: string;
  icon: typeof Zap;
  actionType?: string;
}

interface PaletteCategory {
  name: string;
  items: PaletteItem[];
}

const categories: PaletteCategory[] = [
  {
    name: "Triggers",
    items: [
      { type: "trigger", nodeType: "trigger", label: "Keyword Trigger", icon: Zap },
    ],
  },
  {
    name: "Messages",
    items: [
      {
        type: "sendMessage",
        nodeType: "sendMessage",
        label: "Send Message",
        icon: MessageSquare,
      },
      {
        type: "aiResponse",
        nodeType: "aiResponse",
        label: "AI Response",
        icon: Sparkles,
      },
      // Un recurso de la banca (texto, audio, video, imagen, archivo o enlace).
      {
        type: "action",
        nodeType: "sendAsset",
        label: "Enviar recurso",
        icon: Library,
        actionType: "sendAsset",
      },
    ],
  },
  {
    name: "Logic",
    items: [
      { type: "condition", nodeType: "condition", label: "Condition", icon: GitBranch },
      { type: "delay", nodeType: "delay", label: "Delay", icon: Clock },
      {
        type: "action",
        nodeType: "abSplit",
        label: "A/B Split",
        icon: Shuffle,
        actionType: "abSplit",
      },
      {
        type: "action",
        nodeType: "smartDelay",
        label: "Smart Delay",
        icon: Hourglass,
        actionType: "smartDelay",
      },
    ],
  },
  {
    name: "Actions",
    items: [
      {
        type: "action",
        nodeType: "addTag",
        label: "Add Tag",
        icon: Tag,
        actionType: "addTag",
      },
      {
        type: "action",
        nodeType: "removeTag",
        label: "Remove Tag",
        icon: Tag,
        actionType: "removeTag",
      },
      {
        type: "action",
        nodeType: "setCustomField",
        label: "Set Field",
        icon: FileText,
        actionType: "setCustomField",
      },
      {
        type: "action",
        nodeType: "httpRequest",
        label: "HTTP Request",
        icon: Globe,
        actionType: "httpRequest",
      },
      {
        type: "action",
        nodeType: "goToFlow",
        label: "Go To Flow",
        icon: ArrowRightLeft,
        actionType: "goToFlow",
      },
      {
        type: "action",
        nodeType: "humanTakeover",
        label: "Human Takeover",
        icon: UserCheck,
        actionType: "humanTakeover",
      },
      {
        type: "action",
        nodeType: "subscribe",
        label: "Subscribe",
        icon: Bell,
        actionType: "subscribe",
      },
      {
        type: "action",
        nodeType: "unsubscribe",
        label: "Unsubscribe",
        icon: Bell,
        actionType: "unsubscribe",
      },
      {
        type: "action",
        nodeType: "enrollSequence",
        label: "Enroll in Sequence",
        icon: ListOrdered,
        actionType: "enrollSequence",
      },
      {
        type: "action",
        nodeType: "pauseAgent",
        label: "Pausar agente IA",
        icon: PauseCircle,
        actionType: "pauseAgent",
      },
      {
        type: "action",
        nodeType: "resumeAgent",
        label: "Reanudar agente IA",
        icon: PlayCircle,
        actionType: "resumeAgent",
      },
      // Etapa 4 (F46). El email es lo que hace posibles los flujos de agenda:
      // quien agenda desde la pagina publica no tiene conversacion.
      {
        type: "action",
        nodeType: "send_email",
        label: "Enviar email",
        icon: Mail,
        actionType: "send_email",
      },
      {
        type: "action",
        nodeType: "cancel_booking",
        label: "Cancelar la reunion",
        icon: CalendarX,
        actionType: "cancel_booking",
      },
      {
        type: "action",
        nodeType: "set_booking_status",
        label: "Cambiar estado de la reunion",
        icon: CalendarCheck,
        actionType: "set_booking_status",
      },
    ],
  },
];

function onDragStart(event: DragEvent, item: PaletteItem) {
  const data = JSON.stringify({
    type: item.type,
    nodeType: item.nodeType,
    actionType: item.actionType,
  });
  event.dataTransfer.setData("application/reactflow", data);
  event.dataTransfer.effectAllowed = "move";
}

export function NodePalette() {
  return (
    <div className="flex w-56 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Nodes</h2>
        <p className="text-xs text-muted-foreground">Drag to canvas</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {categories.map((category) => (
          <div key={category.name} className="mb-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {category.name}
            </h3>
            <div className="space-y-1">
              {category.items.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.nodeType}
                    draggable
                    onDragStart={(e) => onDragStart(e, item)}
                    className="flex cursor-grab items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground active:cursor-grabbing"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-xs font-medium">{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
