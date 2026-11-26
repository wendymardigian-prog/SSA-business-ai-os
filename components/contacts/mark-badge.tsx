import { BadgeCheck, HeartHandshake, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MARK_SHORT, type ContactMark } from "@/lib/inbox/marks";
import { Tip } from "@/components/ui/tooltip";

/**
 * Como se ve cada marca del contacto, en UN lugar: el icono y el color de
 * "Conocido" (violeta) y "Cliente" (verde). Lo usan la lista de la bandeja, la
 * cabecera del chat, el panel, la ficha y la lista de contactos.
 */
export const MARK_STYLE: Record<ContactMark, { icon: LucideIcon; chip: string; text: string; soft: string }> = {
  known: {
    icon: HeartHandshake,
    chip: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    text: "text-violet-700 dark:text-violet-300",
    soft: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  },
  customer: {
    icon: BadgeCheck,
    chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    text: "text-emerald-700 dark:text-emerald-300",
    soft: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
};

/**
 * La etiqueta con icono y texto. `size="xs"` es la de la lista de chats (entra
 * en la fila del nombre); `title` es el texto largo ("Cliente de Ana").
 * `iconOnly` deja solo el icono (el texto queda para el lector de pantalla y
 * en el tooltip): en la lista de chats le deja lugar al nombre.
 */
export function MarkBadge({
  mark,
  title,
  size = "sm",
  iconOnly = false,
}: {
  mark: ContactMark;
  title?: string;
  size?: "xs" | "sm";
  iconOnly?: boolean;
}) {
  const { icon: Icon, chip } = MARK_STYLE[mark];
  return (
    <Tip asChild content={title ?? MARK_SHORT[mark]}>
      <span
        className={cn(
          "inline-flex flex-shrink-0 items-center gap-1 rounded-full border font-semibold",
          iconOnly ? "p-0.5" : size === "xs" ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-xs",
          chip,
        )}
      >
        <Icon className={size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
        {iconOnly ? <span className="sr-only">{MARK_SHORT[mark]}</span> : MARK_SHORT[mark]}
        {title && title !== MARK_SHORT[mark] && <span className="sr-only">: {title}</span>}
      </span>
    </Tip>
  );
}
