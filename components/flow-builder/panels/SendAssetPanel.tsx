"use client";

import { useState } from "react";
import { AssetSelect } from "@/components/response-assets/asset-select";
import type { AssetKind } from "@/lib/response-assets/kind";

/**
 * Configuracion del nodo "Enviar recurso": elegir un recurso de la banca y,
 * si lo admite, un texto que lo acompañe.
 *
 * Se guarda el id del recurso y, aparte, su nombre y tipo (`assetName`,
 * `assetKind`): el nodo del canvas los muestra sin tener que leer la banca, y
 * el simulador tambien. El id es lo que manda; si el recurso se renombra, el
 * nodo sigue apuntando al mismo.
 */

interface SendAssetData {
  assetId?: string;
  assetName?: string;
  assetKind?: string;
  caption?: string;
  [key: string]: unknown;
}

const fieldClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";

export function SendAssetPanel({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const node = data as SendAssetData;
  const [liveKind, setLiveKind] = useState<AssetKind | null>(null);
  const kind = liveKind ?? ((node.assetKind as AssetKind | undefined) ?? null);
  // Un audio sale solo, y un texto ya es el mensaje: el resto admite un texto propio.
  const acceptsCaption = kind !== null && kind !== "audio" && kind !== "text";

  return (
    <div className="space-y-4">
      <AssetSelect
        value={node.assetId}
        valueName={node.assetName}
        onKnownKind={setLiveKind}
        onPick={(option) =>
          onChange({ ...node, assetId: option?.id, assetName: option?.name, assetKind: option?.kind })
        }
      />

      {acceptsCaption && (
        <div>
          <label htmlFor="send-asset-caption" className="mb-2 block text-xs font-semibold text-foreground">
            Texto que lo acompaña <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <textarea
            id="send-asset-caption"
            rows={3}
            value={node.caption ?? ""}
            onChange={(e) => onChange({ ...node, caption: e.target.value || undefined })}
            placeholder="Si lo dejás vacío, va el texto que ya tiene el recurso"
            className={`${fieldClass} resize-y`}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground/70">
            Podés usar {"{{contact.display_name}}"}, {"{{contact.email}}"}, {"{{contact.phone}}"} y {"{{workspace.name}}"}.
          </p>
        </div>
      )}

      <p className="text-[11px] leading-snug text-muted-foreground/70">
        Si el canal de la conversación no acepta este tipo de recurso (por ejemplo, Instagram no manda archivos y el
        email solo manda texto y enlaces), el paso se saltea y el flow sigue.
      </p>
    </div>
  );
}
