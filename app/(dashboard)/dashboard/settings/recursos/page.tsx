import { getPermissionContext } from "@/lib/auth/guards";
import { visibleSettingsTabs } from "@/lib/settings/tabs";
import { listAssets } from "@/lib/actions/response-assets";
import { toBankAsset } from "@/lib/response-assets/list";
import { RecursosView } from "./recursos-view";

/**
 * La banca de recursos: textos, audios, videos, imagenes, archivos y enlaces
 * en una sola pantalla. Se llega por dos caminos (banca v2, F3): la pestaña
 * "Recursos" de Ajustes y el item "Recursos" del menu lateral. Una pantalla,
 * una ruta.
 *
 * Entra cualquier miembro: un Member los usa todos los dias desde la bandeja
 * y tiene que poder leer, escuchar y ver cada uno antes de mandarlo. Lo que
 * cambia es si ve los botones de crear, editar y borrar, y eso lo decide el
 * permiso `templates.manage` (no el cargo): la RLS de la 00131 lo exige
 * aunque alguien se saltee la pantalla. `canManage` es solo para no ofrecer
 * botones que van a fallar.
 */
export default async function RecursosPage() {
  const ctx = await getPermissionContext();
  const raw = await listAssets();

  return (
    <RecursosView
      assets={raw.map(toBankAsset)}
      canManage={ctx.can("templates.manage")}
      // Las pestañas de Ajustes se ofrecen solo si hay alguna que esta persona pueda abrir: a quien no tiene
      // ninguna clave de Ajustes (el Member de sistema) lo rebotarian. Recursos no cuenta: la ve cualquiera.
      showSettingsTabs={visibleSettingsTabs(ctx.can).some((t) => t.permissions !== undefined)}
      workspaceName={ctx.workspace.name}
    />
  );
}
