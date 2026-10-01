import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { listAssets } from "@/lib/actions/response-assets";
import { RecursosView, type AssetRow } from "./recursos-view";

/**
 * La banca de recursos: textos (F17) y audios (F20) en una sola pantalla,
 * reemplazando /dashboard/settings/templates y /dashboard/settings/audios.
 *
 * Entra cualquier miembro, no solo Owner/Admin: un Member los usa todos los
 * dias desde la bandeja y tiene que poder leer que dice y escuchar cada uno
 * antes de mandarlo. Lo que cambia segun el rol es si ve los botones de
 * crear, editar y eliminar, y eso lo decide la RLS de la 00105 aunque
 * alguien se saltee la pantalla: `canManage` es solo para no ofrecer
 * botones que van a fallar.
 */
export default async function RecursosPage() {
  const { workspace, role } = await getWorkspace();
  const raw = await listAssets();

  const assets: AssetRow[] = raw.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    shortcut: a.shortcut,
    description: a.description,
    tags: a.tags,
    content: a.content,
    storagePath: a.storage_path,
    mimeType: a.mime_type,
    durationSeconds: a.duration_seconds,
    transcript: a.transcript,
    transcriptStatus: a.transcript_status,
    agentEnabled: a.agent_enabled,
    isActive: a.is_active,
    source: a.source,
  }));

  return <RecursosView assets={assets} canManage={isAdminRole(role)} workspaceName={workspace.name} />;
}
