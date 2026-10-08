import { FileText, Image as ImageIcon, Link2, MessageSquareText, Mic, Video, type LucideIcon } from "lucide-react";
import { ASSET_KIND_LABEL, type AssetKind } from "@/lib/response-assets/kind";

/**
 * El icono de tipo de un recurso, el mismo en todos los lugares que lo pintan
 * (el widget de la bandeja, la pantalla de gestion, las tarjetas de alta)
 * para que no puedan derivar: si el icono de un tipo cambia, cambia en todos.
 *
 * Vive aca y no en lib/response-assets/kind.ts porque ese modulo lo importa
 * la herramienta del agente, que no puede importar React.
 */
export const ASSET_KIND_ICON: Record<AssetKind, LucideIcon> = {
  text: MessageSquareText,
  audio: Mic,
  video: Video,
  image: ImageIcon,
  file: FileText,
  link: Link2,
};

export function AssetKindIcon({ kind, className }: { kind: AssetKind; className?: string }) {
  const Icon = ASSET_KIND_ICON[kind];
  return <Icon className={className} aria-label={ASSET_KIND_LABEL[kind]} />;
}
