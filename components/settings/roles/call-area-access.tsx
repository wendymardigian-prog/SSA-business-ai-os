"use client";

import { assertCanGrant, type GrantActor } from "@/lib/team/grant";
import type { RolePermissions } from "@/lib/auth/permissions";

export interface RoleCallArea {
  id: string;
  name: string;
  archived: boolean;
}

/** Qué áreas de grabaciones ve un rol con el alcance «de ciertas áreas». */
export function CallAreaAccess({
  selected,
  areas,
  viewer,
  before,
  readOnly,
  onChange,
}: {
  selected: string[];
  areas: RoleCallArea[];
  viewer: GrantActor;
  /** Lo último que confirmó el servidor: solo hay que poder dar lo que se agrega sobre eso. */
  before: RolePermissions;
  readOnly: boolean;
  onChange: (next: string[]) => void;
}) {
  const canGive = (id: string) =>
    assertCanGrant(viewer, {
      keys: [],
      callAreas: { wanted: { scopes: { calls: "areas" }, call_areas: [id] }, before },
    }).ok;
  // Un área archivada solo aparece si el rol ya la tiene: así se puede sacar.
  const visible = areas.filter((a) => !a.archived || selected.includes(a.id));

  return (
    <fieldset className="mb-2">
      <legend className="text-xs font-medium">Qué áreas ve</legend>
      {visible.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Todavía no hay áreas. Se crean en Agenda → Configuración → Áreas y tipos.</p>
      ) : (
        <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
          {visible.map((area) => {
            const on = selected.includes(area.id);
            return (
              <label key={area.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={readOnly || (!on && !canGive(area.id))}
                  onChange={() => onChange(on ? selected.filter((id) => id !== area.id) : [...selected, area.id])}
                />
                {area.name}
                {area.archived ? " (archivada)" : ""}
              </label>
            );
          })}
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {selected.length === 0
          ? "Sin ninguna área elegida, ve lo mismo que «Solo los suyos»."
          : "Además de las que grabó y las de los contactos que ve. Las que no tienen área no entran."}
      </p>
    </fieldset>
  );
}
