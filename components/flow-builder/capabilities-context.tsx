"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { Lock, TriangleAlert } from "lucide-react";
import {
  ALL_CONNECTED,
  REQUIREMENT_INFO,
  blockedNodes,
  missingFor,
  needsText,
  requirementsOfNode,
  type BlockedNode,
  type Capabilities,
  type GraphEdgeLike,
  type GraphNodeLike,
  type Requirement,
} from "@/lib/flow-engine/node-requirements";

/**
 * Las conexiones del negocio, a disposicion del lienzo y de la paleta (G1).
 *
 * Se calculan en el servidor al abrir la pantalla y viajan como dato: nada de
 * esto se guarda en el flujo. Al conectar un proveedor y volver al editor, las
 * acciones que dependian de el estan habilitadas sin tocar la automatizacion.
 * Sin proveedor (una pantalla que no cargo las conexiones), todo se ve habilitado.
 */
const CapabilitiesContext = createContext<Capabilities>(ALL_CONNECTED);

export function FlowCapabilitiesProvider({ capabilities, children }: { capabilities: Capabilities; children: ReactNode }) {
  return <CapabilitiesContext.Provider value={capabilities}>{children}</CapabilitiesContext.Provider>;
}

export function useFlowCapabilities(): Capabilities {
  return useContext(CapabilitiesContext);
}

/** Lo que falta para ESTA accion (vacio si puede ejecutarse). */
export function useMissingFor(requires: readonly Requirement[]): Requirement[] {
  return missingFor(requires, useFlowCapabilities());
}

/**
 * El aviso de una accion bloqueada, dentro del nodo del lienzo: "No se va a
 * ejecutar: falta Email saliente (Resend)". Visible siempre (no depende del
 * hover) y con el link para conectarlo.
 */
export function NodeBlockedNotice({ node }: { node: GraphNodeLike }) {
  const missing = useMissingFor(requirementsOfNode(node));
  if (missing.length === 0) return null;
  return (
    <div role="alert" className="border-t border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <p className="flex items-start gap-1.5 font-medium">
        <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden />
        <span>No se va a ejecutar: falta {missing.map((r) => REQUIREMENT_INFO[r].label).join(" y ")}.</span>
      </p>
      <Link href={REQUIREMENT_INFO[missing[0]].href} className="mt-1 inline-block font-medium underline underline-offset-2" target="_blank" rel="noreferrer">
        {REQUIREMENT_INFO[missing[0]].cta}
      </Link>
    </div>
  );
}

/** El candado y el "Necesita: ..." de un item bloqueado de la paleta. */
export function PaletteBlockedNote({ missing }: { missing: readonly Requirement[] }) {
  if (missing.length === 0) return null;
  return (
    <span className="mt-0.5 flex items-start gap-1 text-[10px] leading-snug text-amber-800 dark:text-amber-300">
      <Lock className="mt-px h-2.5 w-2.5 shrink-0" aria-hidden />
      <span>
        {needsText(missing)}.{" "}
        <Link href={REQUIREMENT_INFO[missing[0]].href} className="font-medium underline underline-offset-2" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {REQUIREMENT_INFO[missing[0]].cta}
        </Link>
      </span>
    </span>
  );
}

/**
 * Aviso arriba del lienzo: "2 pasos no se van a ejecutar: falta Email". Para un
 * flujo YA PUBLICADO al que se le desconecto algo (no se despublica solo) y para
 * un borrador que todavia no se puede publicar. Los pasos sueltos no cuentan.
 */
export function FlowConnectionBanner({ nodes, edges, published }: { nodes: GraphNodeLike[]; edges: GraphEdgeLike[]; published: boolean }) {
  const capabilities = useFlowCapabilities();
  const blocked = blockedNodes(nodes, edges, capabilities);
  if (blocked.length === 0) return null;
  return <BannerBody blocked={blocked} published={published} />;
}

function BannerBody({ blocked, published }: { blocked: BlockedNode[]; published: boolean }) {
  const missing = [...new Set(blocked.flatMap((b) => b.missing))];
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-medium">
        {blocked.length === 1 ? "1 paso no se va a ejecutar" : `${blocked.length} pasos no se van a ejecutar`}: {blocked.map((b) => `«${b.name}»`).join(", ")}.
      </span>
      <span>
        Falta {missing.map((r) => REQUIREMENT_INFO[r].label).join(", ")}.{" "}
        {published ? "El flujo sigue publicado." : "Podés guardar el borrador, pero no publicarlo hasta conectarlo."}
      </span>
      {missing.map((r) => (
        <Link key={r} href={REQUIREMENT_INFO[r].href} className="font-medium underline underline-offset-2" target="_blank" rel="noreferrer">
          {REQUIREMENT_INFO[r].cta}
        </Link>
      ))}
    </div>
  );
}
