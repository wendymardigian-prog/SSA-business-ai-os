/**
 * El tipo de un recurso de la banca (`response_assets.kind`).
 *
 * Modulo chico y sin JSX a proposito: lo importan tanto componentes (para el
 * icono y el label) como la herramienta del agente (para el campo `tipo` que
 * le devuelve al modelo), y esta ultima no puede importar React.
 */

export type AssetKind = "text" | "audio";

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  text: "Texto",
  audio: "Audio",
};
