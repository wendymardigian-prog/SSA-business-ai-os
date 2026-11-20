"use client";

import { useEffect, useState } from "react";
import { loadInboxChannelOptions, loadTeamMemberOptions } from "@/lib/actions/flow-node-options";

type Option = { value: string; label: string };

let teamCache: Promise<Option[] | null> | null = null;
let channelCache: Promise<Option[] | null> | null = null;

function useCached(get: () => Promise<Option[] | null>, which: "team" | "channels"): Option[] | null | undefined {
  const [value, setValue] = useState<Option[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const p = get();
    p.then((v) => {
      if (alive) setValue(v);
      if (v === null) {
        if (which === "team") teamCache = null;
        else channelCache = null;
      }
    });
    return () => {
      alive = false;
    };
  }, [get, which]);
  return value;
}

const getTeam = () =>
  (teamCache ??= loadTeamMemberOptions()
    .then((r) => r.members.map((m) => ({ value: m.id, label: m.name })))
    .catch(() => null));
const getChannels = () =>
  (channelCache ??= loadInboxChannelOptions()
    .then((r) => (r.ok ? r.channels.map((c) => ({ value: c.id, label: c.name })) : null))
    .catch(() => null));

/** Las personas del equipo (para filtrar por quién). `undefined` mientras carga; `null` si no se pudo. */
export function useTeamOptions(): Option[] | null | undefined {
  return useCached(getTeam, "team");
}

/** Las cuentas conectadas de la bandeja (Instagram y WhatsApp). */
export function useInboxChannelOptions(): Option[] | null | undefined {
  return useCached(getChannels, "channels");
}
