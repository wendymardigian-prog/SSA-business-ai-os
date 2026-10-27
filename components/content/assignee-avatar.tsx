import { Avatar } from "@/components/ui/filter-menu";
import { colorOf, initialsOf } from "@/lib/shared/people";
import type { AssigneeInfo } from "@/lib/content/assignee";

/**
 * El responsable de una pieza como un circulo con sus iniciales.
 *
 * Es el mismo avatar que usa Tareas: el sistema no guarda fotos de perfil del
 * equipo, asi que el circulo lleva iniciales, con un color que es siempre el
 * mismo para la misma persona. Sin responsable, un circulo vacio con guiones.
 */
export function AssigneeAvatar({ assignee, size = "md" }: { assignee: AssigneeInfo | null; size?: "sm" | "md" }) {
  if (!assignee) {
    return (
      <span
        className={`grid shrink-0 place-items-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground ${
          size === "sm" ? "h-[18px] w-[18px]" : "h-[22px] w-[22px]"
        }`}
        title="Sin responsable"
        role="img"
        aria-label="Sin responsable"
      >
        ?
      </span>
    );
  }
  return (
    <span title={`Responsable: ${assignee.name}`} role="img" aria-label={`Responsable: ${assignee.name}`} className="inline-flex">
      <Avatar initials={initialsOf(assignee.name)} color={colorOf(assignee.id)} size={size} />
    </span>
  );
}
