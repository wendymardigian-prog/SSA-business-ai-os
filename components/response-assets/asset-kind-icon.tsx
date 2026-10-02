import { MessageSquareText, Mic } from "lucide-react";
import { ASSET_KIND_LABEL, type AssetKind } from "@/lib/response-assets/kind";

/**
 * El icono de tipo de un recurso, el mismo en los dos lugares que lo pintan
 * (el picker "/" de la bandeja y la pantalla de administracion) para que no
 * puedan derivar: si el icono de audio cambia, cambia en los dos a la vez.
 */
export function AssetKindIcon({ kind, className }: { kind: AssetKind; className?: string }) {
  const Icon = kind === "audio" ? Mic : MessageSquareText;
  return <Icon className={className} aria-label={ASSET_KIND_LABEL[kind]} />;
}
