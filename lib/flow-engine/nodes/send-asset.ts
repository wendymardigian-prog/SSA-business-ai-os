/**
 * "Enviar recurso" (flows): manda un recurso de la banca por el canal de la
 * conversacion. Los seis tipos: texto, audio, video, imagen, archivo y enlace.
 *
 * Todo lo que importa vive en `deliverAsset` (lib/response-assets/deliver.ts),
 * que es el mismo camino que usa el paso "Recurso" de las secuencias: el canal
 * decide que se puede mandar, el archivo viaja como copia, las variables salen
 * de los datos reales del contacto.
 *
 * Como el resto de los nodos que mandan por un canal, si el flow no tiene canal
 * (un evento de agenda sobre un contacto sin conversacion) se saltea con motivo
 * y el flow sigue. Tambien se saltea, con motivo, un recurso que el canal no
 * acepta o que ya no existe: un flow que se rompe a la mitad por eso deja al
 * lead sin el resto de los mensajes.
 */

import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { deliverAsset } from "@/lib/response-assets/deliver";

export interface SendAssetNodeData {
  /** El recurso de la banca. */
  assetId?: string;
  /** Un texto propio que lo acompaña (imagen, video, archivo o enlace). Reemplaza al del recurso. */
  caption?: string;
}

async function execute({ supabase, data, context, node }: NodeExecutionArgs<SendAssetNodeData>) {
  if (!data.assetId) {
    console.warn(`[flow-engine] el nodo ${node.id} (Enviar recurso) no tiene un recurso elegido`);
    return;
  }

  const result = await deliverAsset(supabase, {
    assetId: data.assetId,
    caption: data.caption ?? null,
    context: {
      ...context,
      channelId: context.channelId || null,
      conversationId: context.conversationId || null,
      nodeId: node.id,
    },
  });

  if (!result.ok) {
    console.warn(`[flow-engine] el nodo ${node.id} (Enviar recurso) no mandó el recurso: ${result.reason}`);
  }
}

export const sendAssetNode: NodeDefinition<SendAssetNodeData> = {
  type: "sendAsset",
  label: "Enviar recurso",
  aliases: [{ nodeType: "action", actionType: "sendAsset" }],
  execute,
};
