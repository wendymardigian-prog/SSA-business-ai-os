"use client";

import { Avatar, ColorDot, FilterMenu, MenuGroupLabel, MenuOption } from "./filter-menu";

/**
 * El filtro de canal.
 *
 * Cada canal lleva su punto de color y si esta conectado: filtrar por un canal
 * sin conectar es valido (muestra el vacio con el boton para conectarlo), pero
 * quien filtra tiene que saber de antemano por que no va a ver nada.
 */

export interface ChannelOption {
  id: string;
  label: string;
  platform: string;
  connected: boolean;
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "var(--ig)",
  whatsapp: "var(--wa)",
  email: "var(--c-auto)",
};

export function channelColor(platform: string): string {
  return PLATFORM_COLORS[platform] ?? "var(--c-ext)";
}

export function ChannelMenu({
  channels,
  value,
  onChange,
}: {
  channels: ChannelOption[];
  value: string | null;
  onChange: (channel: string | null) => void;
}) {
  const current = value ? channels.find((c) => c.id === value) : null;

  return (
    <FilterMenu
      label="Canal"
      active={value !== null}
      icon={current ? <ColorDot color={channelColor(current.platform)} /> : undefined}
      value={current?.label ?? "Todos"}
    >
      <MenuGroupLabel>Canal</MenuGroupLabel>
      <MenuOption
        checked={value === null}
        onSelect={() => onChange(null)}
        leading={<Avatar initials="∗" color="var(--muted)" />}
        title="Todos los canales"
        description={channels.map((c) => c.label).join(" y ") || "Sin canales conectados"}
      />
      {channels.map((c) => (
        <MenuOption
          key={c.id}
          checked={value === c.id}
          onSelect={() => onChange(c.id)}
          leading={<ColorDot color={channelColor(c.platform)} />}
          title={c.label}
          description={c.connected ? "Conectado" : "Sin conectar"}
        />
      ))}
    </FilterMenu>
  );
}
