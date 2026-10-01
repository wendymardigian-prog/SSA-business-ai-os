import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { listAudioAssets } from "@/lib/actions/audio-library";
import { AudiosView, type AudioRow } from "./audios-view";

/**
 * Gestion de la banca de audios (F20).
 *
 * Mismo criterio que templates: entra cualquier miembro (en la bandeja se
 * puede mandar un audio de la banca con "/a"), pero crear/editar/eliminar es
 * solo Owner/Admin. Esa restriccion la aplican las acciones de servidor y la
 * RLS de la 00105; `canManage` es solo para no ofrecer botones que van a
 * fallar.
 */

export default async function AudiosPage() {
  const { role } = await getWorkspace();
  const raw = await listAudioAssets();

  const audios: AudioRow[] = raw.map((a) => ({
    id: a.id,
    name: a.name,
    shortcut: a.shortcut,
    description: a.description,
    storagePath: a.storage_path,
    mimeType: a.mime_type,
    durationSeconds: a.duration_seconds,
    transcript: a.transcript,
    transcriptStatus: a.transcript_status,
    agentEnabled: a.agent_enabled,
    source: a.source,
  }));

  return <AudiosView audios={audios} canManage={isAdminRole(role)} />;
}
