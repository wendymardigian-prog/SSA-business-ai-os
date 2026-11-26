import { PersonAvatar } from "@/components/ui/person-avatar";
import type { AssigneeInfo } from "@/lib/content/assignee";

/**
 * El responsable de una pieza como un circulo con sus iniciales.
 *
 * Es el circulo de siempre de una persona del equipo (`PersonAvatar`): la foto de Mi cuenta si la persona subio una
 * (00273); si no, sus iniciales, con un color que es siempre el mismo para la misma persona. Sin responsable, un
 * circulo punteado con «?». Al pasar el mouse dice «Responsable: …» al instante.
 */
export function AssigneeAvatar({ assignee, size = "md" }: { assignee: AssigneeInfo | null; size?: "sm" | "md" }) {
  return (
    <PersonAvatar
      userId={assignee?.id ?? null}
      name={assignee?.name ?? null}
      role="Responsable"
      size={size}
      emptyLabel="Sin responsable"
    />
  );
}
