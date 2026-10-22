"use client";

import { useState } from "react";
import { datetimeInputToIso, isoToDatetimeInput } from "@/lib/dates";
import type { MarkPublishedChoice } from "@/lib/content/mark-published";
import { platformLabel } from "@/lib/platforms";
import { ContentDialog, DialogField, fieldInput } from "../dialog";
import { NetworkBadge } from "../network-badge";

/**
 * "Publicado…" desde el estado de la pieza (lib/content/mark-published.ts).
 *
 * Para lo que se subio por fuera del sistema (LinkedIn sin cuenta conectada,
 * por ejemplo): las redes donde salio, cuando, y el link de cada una si se
 * tiene. Cada red queda como una publicacion real, igual que con el boton
 * "Marcar como publicado" de su tarjeta, y se deshace desde ahi.
 */
export function MarkPublishedDialog({
  choices,
  timeZone,
  pending,
  onConfirm,
  onClose,
}: {
  choices: MarkPublishedChoice[];
  timeZone: string;
  pending: boolean;
  onConfirm: (input: { items: Array<{ platform: string; url: string | null }>; publishedAt: string | null }) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(choices.map((c) => [c.platform, c.checked])),
  );
  const [urls, setUrls] = useState<Record<string, string>>({});
  // "Ahora" al abrir la ventanita, no cuando se cargo la pieza.
  const [publishedAt, setPublishedAt] = useState(() => isoToDatetimeInput(new Date().toISOString(), timeZone));

  const selected = choices.filter((c) => checked[c.platform]);
  const noNetworks = choices.every((c) => !c.inPiece);

  function confirm() {
    if (selected.length === 0) return;
    onConfirm({
      items: selected.map((c) => ({ platform: c.platform, url: urls[c.platform]?.trim() || null })),
      publishedAt: datetimeInputToIso(publishedAt, timeZone),
    });
  }

  return (
    <ContentDialog
      title="Marcar como publicado"
      label="Marcar como publicado"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={confirm}
            disabled={pending || selected.length === 0}
            className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {selected.length <= 1 ? "Marcar como publicada" : `Marcar ${selected.length} redes como publicadas`}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent"
          >
            Cancelar
          </button>
        </>
      }
    >
      <p className="text-xs text-muted-foreground">
        Para lo que subiste por fuera del sistema. Cada red queda como una publicación real: cuenta en el calendario,
        en Social y en las métricas. Se deshace desde la tarjeta de cada red mientras no tenga métricas.
      </p>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium">
          {noNetworks ? "¿En qué redes salió? (se suman a la pieza)" : "Redes"}
        </legend>
        {choices.length === 0 && (
          <p className="text-xs text-muted-foreground">Todas las redes de la pieza ya están publicadas.</p>
        )}
        {choices.map((c) => (
          <div key={c.platform} className="rounded-lg border border-border p-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(checked[c.platform])}
                onChange={(e) => setChecked((prev) => ({ ...prev, [c.platform]: e.target.checked }))}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              <NetworkBadge platform={c.platform} variant="dot" size="sm" />
              <span className="flex-1">{platformLabel(c.platform)}</span>
            </label>
            {checked[c.platform] && (
              <input
                value={urls[c.platform] ?? ""}
                onChange={(e) => setUrls((prev) => ({ ...prev, [c.platform]: e.target.value }))}
                placeholder="Link del post (opcional) · https://…"
                aria-label={`Link del post en ${platformLabel(c.platform)}`}
                className={`${fieldInput} mt-2`}
              />
            )}
          </div>
        ))}
      </fieldset>

      <DialogField label="Cuándo se publicó" hint="La misma fecha para todas las redes que marques.">
        <input
          type="datetime-local"
          value={publishedAt}
          onChange={(e) => setPublishedAt(e.target.value)}
          className={fieldInput}
        />
      </DialogField>
    </ContentDialog>
  );
}
