"use client";

import { PageHeader } from "@/components/page-header";
import { ChannelsPanel, type Channel } from "@/components/channels/channels-panel";

/**
 * La pagina de canales: todos los canales conectados. Ya no esta en el menu: se
 * llega desde Integraciones. El cuerpo (las tarjetas, Sincronizar y Conectar
 * canal) es `ChannelsPanel`, el mismo que se ve en la pestaña Cuentas de Zernio
 * y de Evolution.
 */
export function ChannelsView({ channels }: { channels: Channel[]; workspaceId: string }) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/channels" />
      <div className="flex-1 overflow-auto p-8">
        <ChannelsPanel channels={channels} />
      </div>
    </div>
  );
}
