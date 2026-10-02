"use client";

import { Avatar, FilterMenu, MenuGroupLabel, MenuOption } from "@/components/ui/filter-menu";
import { initialsOf } from "@/lib/dashboards/chat/team-rows";

/**
 * El filtro "Respondido por", en tres grupos: el agente, las personas del
 * equipo, y los otros (automatizaciones y lo que se respondio afuera).
 *
 * Los valores son los que la funcion SQL reconoce. "Equipo" no es una opcion a
 * proposito: se filtra por persona, no por el grupo, porque la pregunta real es
 * "que hizo Sofia", no "que hizo el equipo junto".
 */

export interface AuthorMember {
  id: string;
  label: string;
  role: string;
}

const GROUPS = [
  { value: "agent", title: "Agente IA", description: "Envío directo y borradores aprobados", initials: "IA", color: "var(--c-agent)" },
  { value: "automations", title: "Automatizaciones", description: "Flows, secuencias y broadcasts", initials: "⚡", color: "var(--c-auto)" },
  { value: "external", title: "Fuera del sistema", description: "App de Instagram, ManyChat u otra herramienta", initials: "?", color: "var(--c-ext)" },
];

/** El nombre de lo que esta filtrado, para los chips y los avisos. */
export function authorLabel(value: string | null, members: AuthorMember[]): string {
  if (value === null) return "Todos";
  const group = GROUPS.find((g) => g.value === value);
  if (group) return group.title;
  return members.find((m) => m.id === value)?.label ?? "Alguien del equipo";
}

export function AuthorMenu({
  members,
  value,
  onChange,
}: {
  members: AuthorMember[];
  value: string | null;
  onChange: (author: string | null) => void;
}) {
  const group = GROUPS.find((g) => g.value === value);
  const member = members.find((m) => m.id === value);
  const shortLabel = group ? group.title : (member ? member.label.split(" ")[0] : "Todos");

  return (
    <FilterMenu
      label="Respondido por"
      active={value !== null}
      icon={
        group ? (
          <Avatar initials={group.initials} color={group.color} size="sm" />
        ) : member ? (
          <Avatar initials={initialsOf(member.label)} color="var(--c-team)" size="sm" />
        ) : undefined
      }
      value={shortLabel}
    >
      <MenuOption
        checked={value === null}
        onSelect={() => onChange(null)}
        leading={<Avatar initials="∗" color="var(--muted)" />}
        title="Todos"
        description="Cualquier mensaje saliente"
      />

      <MenuGroupLabel>Agente</MenuGroupLabel>
      <MenuOption
        checked={value === "agent"}
        onSelect={() => onChange("agent")}
        leading={<Avatar initials="IA" color="var(--c-agent)" />}
        title="Agente IA"
        description="Envío directo y borradores aprobados"
      />

      {members.length > 0 && <MenuGroupLabel>Personas del equipo</MenuGroupLabel>}
      {members.map((m) => (
        <MenuOption
          key={m.id}
          checked={value === m.id}
          onSelect={() => onChange(m.id)}
          leading={<Avatar initials={initialsOf(m.label)} color="var(--c-team)" />}
          title={m.label}
          description={m.role}
        />
      ))}

      <MenuGroupLabel>Otros</MenuGroupLabel>
      {GROUPS.filter((g) => g.value !== "agent").map((g) => (
        <MenuOption
          key={g.value}
          checked={value === g.value}
          onSelect={() => onChange(g.value)}
          leading={<Avatar initials={g.initials} color={g.color} />}
          title={g.title}
          description={g.description}
        />
      ))}
    </FilterMenu>
  );
}
