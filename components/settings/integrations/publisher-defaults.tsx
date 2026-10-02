"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDefaultPublisher } from "@/lib/actions/social-accounts";
import { canChooseDefault, PUBLISHER_LABELS, type PublisherEntry, type PublisherId } from "@/lib/social/accounts-schema";
import { metricsSourceLine } from "@/lib/integrations/metrics-source";

export interface SocialAccountRow {
  id: string;
  platform: string;
  defaultPublisher: string | null;
  publishers: PublisherEntry[];
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  threads: "Threads",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};

const STATUS_TEXT: Record<PublisherEntry["status"], (reason: string | null) => string> = {
  available: () => "disponible",
  unverified: () => "sin probar todavia",
  unavailable: (reason) => `no disponible${reason ? ` — ${reason}` : ""}`,
};

/**
 * Por donde sale cada red, y el publicador por defecto de cada cuenta (G7).
 *
 * Reemplaza al "selector de fuente de metricas" que no tenia sentido:
 * Postproxy no lee metricas de nada. Lo que si es una eleccion real es por
 * donde se PUBLICA, que hoy solo se podia elegir post por post.
 */
export function PublisherDefaults({ accounts }: { accounts: SocialAccountRow[] }) {
  if (accounts.length === 0) {
    return <p className="text-xs text-muted-foreground">Todavia no hay ninguna cuenta conectada.</p>;
  }
  return (
    <div className="space-y-3">
      {accounts.map((account) => (
        <AccountRow key={account.id} account={account} />
      ))}
    </div>
  );
}

function AccountRow({ account }: { account: SocialAccountRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const metricsLine = metricsSourceLine(account.platform);

  function onChange(value: string) {
    setError(null);
    start(async () => {
      const result = await setDefaultPublisher(account.id, value as PublisherId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{PLATFORM_LABELS[account.platform] ?? account.platform}</span>
        <select
          value={account.defaultPublisher ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={pending}
          className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
        >
          <option value="" disabled>
            Elegir publicador
          </option>
          {account.publishers.map((p) => (
            <option
              key={p.publisher}
              value={p.publisher}
              disabled={!canChooseDefault(account.publishers, p.publisher)}
            >
              {PUBLISHER_LABELS[p.publisher]}
              {p.status !== "available" ? ` (${STATUS_TEXT[p.status](p.status_reason)})` : ""}
            </option>
          ))}
        </select>
      </div>

      <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        {account.publishers.map((p) => (
          <li key={p.publisher}>
            {PUBLISHER_LABELS[p.publisher]}: {STATUS_TEXT[p.status](p.status_reason)}
          </li>
        ))}
      </ul>

      {metricsLine && <p className="mt-2 text-[11px] text-muted-foreground">{metricsLine}</p>}
      {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
