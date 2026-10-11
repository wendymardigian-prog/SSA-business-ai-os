import { AudioLines, BarChart3, BookOpenCheck, Image as ImageIcon, ListFilter, NotebookPen, NotebookText, PhoneCall, Tags, Thermometer, type LucideIcon } from "lucide-react";
import type { AiTaskIcon } from "@/lib/ai-tasks/catalog";

/** El componente de lucide-react para cada ícono del catálogo de tareas. */
const TASK_ICON_COMPONENTS: Record<AiTaskIcon, LucideIcon> = {
  ListFilter,
  NotebookText,
  Thermometer,
  BookOpenCheck,
  AudioLines,
  ImageIcon,
  BarChart3,
  Tags,
  PhoneCall,
  NotebookPen,
};

export function TaskIcon({ icon, className }: { icon: AiTaskIcon; className?: string }) {
  const Icon = TASK_ICON_COMPONENTS[icon];
  return <Icon className={className} aria-hidden />;
}
