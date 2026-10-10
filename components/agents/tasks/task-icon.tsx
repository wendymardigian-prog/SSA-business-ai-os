import { AudioLines, BookOpenCheck, Image as ImageIcon, ListFilter, NotebookText, Thermometer, type LucideIcon } from "lucide-react";
import type { AiTaskIcon } from "@/lib/ai-tasks/catalog";

/** El componente de lucide-react para cada ícono del catálogo de tareas. */
const TASK_ICON_COMPONENTS: Record<AiTaskIcon, LucideIcon> = {
  ListFilter,
  NotebookText,
  Thermometer,
  BookOpenCheck,
  AudioLines,
  ImageIcon,
};

export function TaskIcon({ icon, className }: { icon: AiTaskIcon; className?: string }) {
  const Icon = TASK_ICON_COMPONENTS[icon];
  return <Icon className={className} aria-hidden />;
}
