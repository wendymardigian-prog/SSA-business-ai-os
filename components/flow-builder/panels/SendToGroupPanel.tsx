"use client";

import { WhatsappBanRiskNotice } from "@/components/channels/whatsapp-ban-risk-notice";
import { AssetSelect } from "@/components/response-assets/asset-select";
import type { SendToGroupData } from "@/lib/flow-engine/nodes/send-to-group";
import type { InviteToGroupData } from "@/lib/flow-engine/nodes/invite-to-group";
import { GroupSelect } from "./group-select";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";
const hintClass = "mt-1.5 text-[11px] leading-snug text-muted-foreground/70";

/**
 * «Enviar al grupo» (00344): a qué grupo (también los de una comunidad), un texto y/o un recurso de la banca. Con
 * «En una fecha y hora» sirve para mensajes y archivos programados.
 */
export function SendToGroupPanel({ data: raw, onChange }: { data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const data = raw as SendToGroupData & { assetName?: string; assetKind?: string } & Record<string, unknown>;
  return (
    <div className="space-y-4">
      <WhatsappBanRiskNotice />
      <div>
        <label htmlFor="group-send-group" className={labelClass}>A qué grupo</label>
        <GroupSelect id="group-send-group" value={data.groupId} onChange={(groupId) => onChange({ ...data, groupId })} />
        <p className={hintClass}>Si en el grupo solo escriben los admins y el número no es admin, el paso se saltea.</p>
      </div>
      <div>
        <label htmlFor="group-send-text" className={labelClass}>Mensaje</label>
        <textarea
          id="group-send-text"
          rows={4}
          value={data.text ?? ""}
          onChange={(e) => onChange({ ...data, text: e.target.value || undefined })}
          placeholder="¡Hola a todos! Hoy a las 19 h arranca la clase."
          className={`${inputClass} resize-y`}
        />
        <p className={hintClass}>Podés usar {"{{workspace.name}}"} y las variables del disparador. Con un archivo, va como pie.</p>
      </div>
      <div>
        <p className={labelClass}>
          Recurso de la banca <span className="font-normal text-muted-foreground">(opcional)</span>
        </p>
        <AssetSelect
          value={data.assetId}
          valueName={data.assetName}
          onPick={(option) => onChange({ ...data, assetId: option?.id, assetName: option?.name, assetKind: option?.kind })}
        />
        <p className={hintClass}>Una imagen, un video o un archivo van adjuntos; un texto o un enlace se suman al mensaje. Los audios no se mandan a grupos.</p>
      </div>
    </div>
  );
}

/** «Invitar a un grupo» (00344): suma al contacto o le manda el link por privado. */
export function InviteToGroupPanel({ data: raw, onChange }: { data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const data = raw as InviteToGroupData & Record<string, unknown>;
  return (
    <div className="space-y-4">
      <WhatsappBanRiskNotice />
      <div>
        <label htmlFor="group-invite-group" className={labelClass}>A qué grupo</label>
        <GroupSelect id="group-invite-group" value={data.groupId} onChange={(groupId) => onChange({ ...data, groupId })} />
        <p className={hintClass}>El número tiene que ser admin del grupo. Para una comunidad, elegí el grupo de la comunidad al que entra.</p>
      </div>
      <fieldset className="space-y-2">
        <legend className={labelClass}>Cómo</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="group-invite-mode" checked={!data.linkOnly} onChange={() => onChange({ ...data, linkOnly: undefined })} className="mt-1" />
          <span>Sumarlo al grupo; si WhatsApp no deja, mandarle el link por privado</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="group-invite-mode" checked={data.linkOnly === true} onChange={() => onChange({ ...data, linkOnly: true })} className="mt-1" />
          <span>Solo mandarle el link por privado (entra si quiere)</span>
        </label>
      </fieldset>
      <p className={hintClass}>Usa el WhatsApp del contacto o su teléfono. Respeta «no contactar».</p>
    </div>
  );
}
