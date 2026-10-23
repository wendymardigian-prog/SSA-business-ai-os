"use client";

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Rocket, Loader2, History, Play, Download, Trash2, Info, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { flowFingerprint } from "@/lib/unsaved-changes";
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Database } from "@/lib/types/database";
import { discardFlowDraft, saveFlowDraft } from "@/lib/actions/flows";
import { applyTriggerChoice, choiceKeyFor, chosenType, hasTriggerConfig, type TriggerChoice } from "@/lib/flow-engine/trigger-catalog";
import { FlowDetailsDialog, type FlowDetails } from "@/components/flows/flow-details-dialog";
import { TriggerPicker } from "./trigger-picker";
import { conditionToBranch, type ConvertibleEdge, type ConvertibleNode } from "@/lib/flow-engine/convert-condition";
import { newPathId, pathsOf } from "@/lib/flow-engine/branch-paths";
import { pruneBranchEdges } from "@/lib/automations/branch-edit";

import { NodePalette, type PaletteItem } from "./node-palette";
import { FlowCapabilitiesProvider, FlowConnectionBanner, useFlowCapabilities } from "./capabilities-context";
import {
  ALL_CONNECTED,
  blockedNodes,
  requirementProblems,
  type Capabilities,
  type GraphEdgeLike,
  type GraphNodeLike,
} from "@/lib/flow-engine/node-requirements";
import { TriggerNode } from "./nodes/trigger-node";
import { SendMessageNode } from "./nodes/send-message-node";
import { ConditionNode } from "./nodes/condition-node";
import { BranchNode } from "./nodes/branch-node";
import { UpsertContactNode } from "./nodes/upsert-contact-node";
import { DelayNode } from "./nodes/delay-node";
import { ActionNode } from "./nodes/action-node";
import { AiResponseNode } from "./nodes/AiResponseNode";
import { NodeConfigSidebar } from "./panels/NodeConfigSidebar";
import { VersionHistoryPanel } from "./panels/VersionHistoryPanel";
import { TestPanel } from "./panels/TestPanel";
import { isNoContactTriggerType } from "@/lib/flow-engine/contact-free";
import { newNodeAttribution, type AttributionDefaults } from "@/lib/attribution/panel-view";

type Flow = Database["public"]["Tables"]["flows"]["Row"];

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  sendMessage: SendMessageNode,
  condition: ConditionNode,
  branch: BranchNode,
  upsert_contact: UpsertContactNode,
  delay: DelayNode,
  action: ActionNode,
  aiResponse: AiResponseNode,
};

interface FlowCanvasProps {
  flow: Flow;
  /**
   * Las conexiones del negocio hoy (G1): deciden que acciones se ven bloqueadas. Se calculan en el servidor al abrir la
   * pantalla; sin esto todo se ve habilitado (como antes).
   */
  capabilities?: Capabilities;
  /** Los valores por defecto de atribución del negocio (Ajustes → Atribución). Sin esto, los nodos nuevos nacen sin atribución. */
  attributionDefaults?: AttributionDefaults;
}

const NO_ATTRIBUTION_DEFAULTS: AttributionDefaults = { append: false, trackClicks: true };

let nodeId = 0;
function getNodeId() {
  return `node_${Date.now()}_${nodeId++}`;
}

function getDefaultData(type: string, actionType?: string, attributionDefaults?: AttributionDefaults): Record<string, unknown> {
  switch (type) {
    case "trigger":
      // Nace SIN elegir: la persona elige como arranca en el selector (antes nacia como palabra clave).
      return { triggerType: null };
    case "sendMessage": {
      // Un nodo de envío nuevo nace con la atribución encendida solo si el negocio la tiene así por defecto (F39).
      const attribution = attributionDefaults ? newNodeAttribution(attributionDefaults) : undefined;
      return attribution ? { messages: [], attribution } : { messages: [] };
    }
    case "condition":
      return { conditions: [], logic: "and" };
    case "branch":
      // Nace con un camino (la base exige al menos uno); las condiciones se arman en el panel.
      return { paths: [{ id: newPathId(), label: "Camino 1", logic: "and", conditions: [] }] };
    case "upsert_contact":
      // Los valores por defecto del paso (crear o actualizar, completar lo vacio, formulario externo).
      return { mode: "create_or_update", update: "fill_empty", map: [], tags: { fixed: [] }, attribution: { map: [], autoDetect: true }, touchMedium: "external_form" };
    case "delay":
      return { duration: 5, unit: "minutes" };
    case "aiResponse":
      // Sin proveedor ni modelo: corre con el modelo por defecto de la IA conectada. Antes nacia con
      // "openai/gpt-4o-mini", un id del AI Gateway que ningun proveedor acepta, y un nodo sin tocar fallaba.
      return { systemPrompt: "", temperature: 0.7, maxTokens: 500, contextMessages: 10 };
    case "action":
      return { actionType: actionType || "addTag" };
    default:
      return {};
  }
}

const STATUS_LABELS: Record<string, string> = { draft: "Borrador", published: "Publicada", archived: "Archivada" };

/**
 * El grafo con el que abre el lienzo: los cambios sin publicar si los hay (00254), si no lo guardado. Siempre con UN
 * disparador: una automatizacion vieja (o vacia) sin disparador recibe uno sin elegir. El disparador no se borra.
 */
function initialGraph(flow: Flow): { nodes: Node[]; edges: Edge[] } {
  const useDraft = Array.isArray(flow.draft_nodes);
  const rawNodes = useDraft ? flow.draft_nodes : Array.isArray(flow.nodes) ? flow.nodes : [];
  const rawEdges = useDraft ? (Array.isArray(flow.draft_edges) ? flow.draft_edges : []) : Array.isArray(flow.edges) ? flow.edges : [];
  let nodes = (rawNodes as unknown as Node[]).map((n) => (n.type === "trigger" ? { ...n, deletable: false } : n));
  if (!nodes.some((n) => n.type === "trigger")) {
    nodes = [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: null }, deletable: false }, ...nodes];
  }
  return { nodes, edges: rawEdges as unknown as Edge[] };
}

function FlowCanvasInner({ flow, attributionDefaults = NO_ATTRIBUTION_DEFAULTS }: FlowCanvasProps) {
  const router = useRouter();
  const capabilities = useFlowCapabilities();
  // Los pasos bloqueados que YA tenia lo guardado: un flujo publicado se puede seguir editando aunque a un paso se le
  // haya desconectado algo; lo que no se deja es guardar un paso NUEVO sin su conexion (saldria en vivo sin ejecutarse).
  const [initial] = useState(() => initialGraph(flow));
  const initialNodes = initial.nodes;
  const initialEdges = initial.edges;
  const savedGraph = useRef<{ nodes: unknown[]; edges: unknown[] }>({ nodes: initialNodes, edges: initialEdges });
  const [publishProblems, setPublishProblems] = useState<string[]>([]);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getViewport } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [flowName, setFlowName] = useState(flow.name);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [testPanelOpen, setTestPanelOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Una automatizacion publicada con cambios que todavia no corren (00254).
  const [hasDraft, setHasDraft] = useState(flow.status === "published" && Array.isArray(flow.draft_nodes));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [details, setDetails] = useState<FlowDetails>({ name: flow.name, description: flow.description ?? null, categories: flow.categories ?? [] });
  const [detailsOpen, setDetailsOpen] = useState(false);
  // El selector de disparador: se abre solo si todavia no se eligio como arranca.
  const triggerNode = nodes.find((n) => n.type === "trigger");
  const triggerChosen = chosenType((triggerNode?.data ?? {}) as Record<string, unknown>) !== null;
  const [pickerOpen, setPickerOpen] = useState(() => !triggerChosen);
  const [pendingChoice, setPendingChoice] = useState<TriggerChoice | null>(null);

  const unsaved = useUnsavedChanges({
    current: flowFingerprint(nodes, edges, flowName),
    initial: flowFingerprint(initialNodes, initialEdges, flow.name),
  });
  const { markSaved } = unsaved;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId) || null
    : null;

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: "var(--border)", strokeWidth: 2 },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const raw = event.dataTransfer.getData("application/reactflow");
      if (!raw) return;

      const { type, nodeType, actionType } = JSON.parse(raw) as {
        type: string;
        nodeType: string;
        actionType?: string;
      };

      // Un solo disparador por automatizacion, y los pasos recien despues de elegirlo.
      if (type === "trigger" || !triggerChosen) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: getNodeId(),
        type,
        position,
        data: getDefaultData(type, actionType || nodeType, attributionDefaults),
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes, attributionDefaults, triggerChosen]
  );

  // Tocar un paso de la paleta (o Enter): se suma debajo del ultimo paso, sin arrastrar.
  const addFromPalette = useCallback(
    (item: PaletteItem) => {
      if (!triggerChosen) return;
      setNodes((nds) => {
        const lowest = nds.reduce<Node | null>((acc, n) => (!acc || n.position.y > acc.position.y ? n : acc), null);
        const { x, y, zoom } = getViewport();
        const position = lowest ? { x: lowest.position.x, y: lowest.position.y + 140 } : { x: -x / zoom + 200, y: -y / zoom + 120 };
        const newNode: Node = { id: getNodeId(), type: item.type, position, data: getDefaultData(item.type, item.actionType || item.nodeType, attributionDefaults) };
        return [...nds, newNode];
      });
    },
    [triggerChosen, setNodes, getViewport, attributionDefaults]
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
    },
    []
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const onNodeDataChange = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: newData } : n
        )
      );
      // Borrar un camino de "Condiciones" suelta las conexiones que salian de el.
      if (Array.isArray((newData as { paths?: unknown }).paths)) {
        const paths = pathsOf(newData as never);
        setEdges((eds) => pruneBranchEdges(nodeId, paths, eds));
      }
    },
    [setNodes, setEdges]
  );

  // "Convertir a Condiciones": un `condition` pasa a ser un `branch` con un camino, y sus salidas
  // «Sí» / «No» pasan a ser el camino y «Si no». No cambia a donde va nadie.
  const convertCondition = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || node.type !== "condition") return;
      const converted = conditionToBranch(node as unknown as ConvertibleNode, edges as unknown as ConvertibleEdge[]);
      setNodes((nds) => nds.map((n) => (n.id === nodeId ? (converted.node as unknown as Node) : n)));
      setEdges(converted.edges as unknown as Edge[]);
    },
    [nodes, edges, setNodes, setEdges]
  );

  const closeSidebar = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const deleteNode = useCallback(
    (nodeId: string) => {
      // El disparador no se borra: se cambia.
      if (nodes.find((n) => n.id === nodeId)?.type === "trigger") return;
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
    },
    [nodes, setNodes, setEdges]
  );

  // Elegir (o cambiar) el disparador. Si el que estaba tenia configuracion, se confirma antes de perderla.
  const applyChoice = useCallback(
    (choice: TriggerChoice) => {
      setNodes((nds) =>
        nds.map((n) => (n.type === "trigger" ? { ...n, deletable: false, data: applyTriggerChoice(n.data as Record<string, unknown>, choice) } : n))
      );
      setPickerOpen(false);
      setPendingChoice(null);
      const id = nodes.find((n) => n.type === "trigger")?.id;
      if (id) setSelectedNodeId(id);
    },
    [setNodes, nodes]
  );
  const handlePick = useCallback(
    (choice: TriggerChoice) => {
      const data = (triggerNode?.data ?? {}) as Record<string, unknown>;
      if (choiceKeyFor(data) === choice.key) {
        setPickerOpen(false);
        return;
      }
      if (chosenType(data) && hasTriggerConfig(data)) {
        setPendingChoice(choice);
        return;
      }
      applyChoice(choice);
    },
    [triggerNode, applyChoice]
  );

  const saveFlow = useCallback(
    async (): Promise<boolean> => {
      // Un flujo publicado: guardar un paso NUEVO sin su conexion lo dejaria listo para publicarse sin poder ejecutarse (G1.4).
      if (flow.status === "published") {
        const before = new Set(blockedNodes(savedGraph.current.nodes as GraphNodeLike[], savedGraph.current.edges as GraphEdgeLike[], capabilities).map((b) => b.nodeId));
        const added = blockedNodes(nodes as unknown as GraphNodeLike[], edges as unknown as GraphEdgeLike[], capabilities).filter((b) => !before.has(b.nodeId));
        if (added.length > 0) {
          setPublishProblems(requirementProblems(added).map((p) => p.replace(/ y volvé a publicar\.$/, ". Conectalo para guardar este cambio en un flujo publicado.")));
          setSaveError("No se guardó");
          setTimeout(() => setSaveError(null), 3000);
          return false;
        }
      }

      setSaving(true);
      try {
        // Por el servidor (no directo a la base): en una automatizacion PUBLICADA esto va a los cambios sin publicar y
        // lo que corre no cambia hasta "Publicar cambios".
        const res = await saveFlowDraft({ flowId: flow.id, name: flowName, nodes: nodes as unknown[], edges: edges as unknown[] });
        if (!res.ok) {
          setSaveError(res.error);
          setTimeout(() => setSaveError(null), 4000);
          return false;
        }
        setHasDraft(res.unpublishedChanges);
        setSaveError(null);
        setLastSaved(new Date());
        markSaved();
        savedGraph.current = { nodes: nodes as unknown[], edges: edges as unknown[] };
        return true;
      } catch {
        setSaveError("No se pudo guardar. Probá de nuevo.");
        setTimeout(() => setSaveError(null), 4000);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [flowName, nodes, edges, flow.id, flow.status, markSaved, capabilities]
  );

  const handleDiscard = useCallback(async () => {
    const res = await discardFlowDraft(flow.id);
    if (!res.ok) {
      setSaveError(res.error);
      setTimeout(() => setSaveError(null), 4000);
      return;
    }
    const restored = initialGraph({ ...flow, draft_nodes: null, draft_edges: null, nodes: res.nodes as never, edges: res.edges as never });
    setNodes(restored.nodes);
    setEdges(restored.edges);
    savedGraph.current = { nodes: restored.nodes, edges: restored.edges };
    setHasDraft(false);
    setSelectedNodeId(null);
    router.refresh();
  }, [flow, setNodes, setEdges, router]);

  const handleSave = useCallback(() => saveFlow(), [saveFlow]);
  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/flows/${flow.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        console.error("[flows] no se pudo borrar la automatizacion");
        setSaveError("No se pudo borrar");
        setTimeout(() => setSaveError(null), 3000);
        setDeleting(false);
        return;
      }
      router.push("/dashboard/flows");
    } catch (err) {
      console.error("[flows] no se pudo borrar la automatizacion:", err);
      setSaveError("No se pudo borrar");
      setTimeout(() => setSaveError(null), 3000);
      setDeleting(false);
    }
  }, [flow.id, router]);
  const handlePublish = useCallback(async () => {
    setPublishing(true);
    try {
      setPublishProblems([]);
      // First save the current state
      if (!(await saveFlow())) return;
      // Then call the publish API which increments version and saves snapshot
      const res = await fetch(`/api/v1/flows/${flow.id}/publish`, {
        method: "POST",
      });
      if (!res.ok) {
        // El servidor dice QUE falta (una conexion, un contacto...): se muestra, no un "Failed to publish" mudo (G1).
        const body = (await res.json().catch(() => null)) as { error?: unknown; problems?: unknown } | null;
        const problems = Array.isArray(body?.problems)
          ? body.problems.filter((p): p is string => typeof p === "string")
          : typeof body?.error === "string"
            ? [body.error]
            : [];
        setPublishProblems(problems.length > 0 ? problems : ["No se pudo publicar. Probá de nuevo en un momento."]);
        setSaveError("No se publicó");
        setTimeout(() => setSaveError(null), 3000);
        return;
      }
      setSaveError(null);
      setLastSaved(new Date());
      setHasDraft(false);
      router.refresh();
    } finally {
      setPublishing(false);
    }
  }, [saveFlow, flow.id, router]);

  return (
    <div className="flex h-full flex-col">
      {/* La barra de arriba mide 56 px como en todas las pantallas (F13). Antes
          el alto lo definia el contenido y esta quedaba mas alta que el resto. */}
      <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => unsaved.guard(() => router.push("/dashboard/flows"))}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </button>
          <div className="h-5 w-px bg-border" />
          <input
            type="text"
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            className="w-auto max-w-[200px] border-none bg-transparent text-sm font-semibold outline-none focus:ring-0"
            style={{ width: `${Math.max(flowName.length, 8)}ch` }}
            placeholder="Nombre de la automatización"
            aria-label="Nombre de la automatización"
          />
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
              flow.status === "published"
                ? "bg-emerald-100 text-emerald-800"
                : flow.status === "archived"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {STATUS_LABELS[flow.status] ?? flow.status}
          </span>
          {hasDraft && (
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" title="Lo que corre es la última versión publicada. Publicá para que los cambios empiecen a correr.">
              Cambios sin publicar
            </span>
          )}
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="Nombre, descripción y categorías"
          >
            <Info className="h-3.5 w-3.5" />
            Detalles
          </button>
        </div>
        <div className="flex items-center gap-2">
          {saveError && (
            <span className="text-xs font-medium text-destructive">
              {saveError}
            </span>
          )}
          {/*
            Antes decia "Saved 14:32" aunque hubieras movido veinte nodos
            despues: lastSaved es la hora del ultimo guardado y nunca se
            comparaba con el estado actual. Ahora son tres estados excluyentes.
          */}
          {!saveError && unsaved.dirty && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Cambios sin guardar
            </span>
          )}
          {!saveError && !unsaved.dirty && lastSaved && (
            <span className="text-xs text-muted-foreground">
              Guardado {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => {
              setTestPanelOpen(!testPanelOpen);
              if (!testPanelOpen) {
                setVersionPanelOpen(false);
                setSelectedNodeId(null);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              testPanelOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background hover:bg-accent"
            )}
          >
            <Play className="h-3.5 w-3.5" />
            Probar
          </button>
          <button
            onClick={() => {
              setVersionPanelOpen(!versionPanelOpen);
              if (!versionPanelOpen) {
                setTestPanelOpen(false);
                setSelectedNodeId(null);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              versionPanelOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background hover:bg-accent"
            )}
          >
            <History className="h-3.5 w-3.5" />
            Versiones
          </button>
          <button
            onClick={() => {
              const exportData = {
                name: flowName,
                description: details.description || null,
                categories: details.categories,
                nodes,
                edges,
                version: flow.version || 1,
                exportedAt: new Date().toISOString(),
                source: "business-os",
              };
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${flowName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.flow.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {flow.status === "published" ? "Guardar borrador" : "Guardar"}
          </button>
          {hasDraft && (
            <button
              onClick={() => setConfirmDiscard(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
              title="Volver a la versión que está corriendo"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Descartar cambios
            </button>
          )}
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {publishing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            {flow.status === "published" ? "Publicar cambios" : "Publicar"}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            title="Borrar automatización"
            aria-label="Borrar automatización"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
          <ConfirmDialog {...unsaved.confirmProps} />
          <ConfirmDialog
            open={confirmDiscard}
            title="Descartar los cambios sin publicar"
            message="Vuelve a la versión que está corriendo ahora. Lo que cambiaste desde la última publicación se pierde."
            confirmLabel="Descartar"
            destructive
            onConfirm={() => {
              setConfirmDiscard(false);
              void handleDiscard();
            }}
            onCancel={() => setConfirmDiscard(false)}
          />
          <ConfirmDialog
            open={pendingChoice !== null}
            title="Cambiar el disparador"
            message={`Lo que configuraste en el disparador actual (palabras clave, filtros…) se pierde. ¿Cambiar a «${pendingChoice?.label ?? ""}»?`}
            confirmLabel="Cambiar"
            onConfirm={() => pendingChoice && applyChoice(pendingChoice)}
            onCancel={() => setPendingChoice(null)}
          />
          <ConfirmDialog
            open={confirmDelete}
            title="Borrar automatización"
            message={`«${flowName}» se borra con sus disparadores, versiones e historial de ejecuciones. No se puede deshacer.`}
            confirmLabel="Borrar"
            destructive
            onConfirm={() => {
              setConfirmDelete(false);
              handleDelete();
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        </div>
      </div>

      {/* Los pasos que no se van a ejecutar por una conexion que falta (G1.6): un flujo publicado no se despublica solo. */}
      <FlowConnectionBanner nodes={nodes as unknown as GraphNodeLike[]} edges={edges as unknown as GraphEdgeLike[]} published={flow.status === "published"} />

      {publishProblems.length > 0 && (
        <div role="alert" className="flex items-start gap-3 border-b border-red-300/60 bg-red-50 px-4 py-2.5 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{publishProblems.length === 1 ? "No se pudo publicar por esto:" : `No se pudo publicar por estas ${publishProblems.length} cosas:`}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {publishProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={() => setPublishProblems([])} className="shrink-0 rounded-md px-2 py-1 font-medium hover:bg-red-100 dark:hover:bg-red-900/40">
            Entendido
          </button>
        </div>
      )}

      {/* Canvas area */}
      <div className="flex flex-1 overflow-hidden">
        <NodePalette
          memberFlow={nodes.some((n) => n.type === "trigger" && isNoContactTriggerType((n.data as { triggerType?: unknown } | undefined)?.triggerType))}
          locked={!triggerChosen}
          onAdd={addFromPalette}
        />
        <div ref={reactFlowWrapper} className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
            className="bg-background"
          >
            <Background gap={16} size={1} className="!bg-background" />
            <Controls
              className="!border-border !bg-card !shadow-sm [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground [&>button:hover]:!bg-accent"
            />
            <MiniMap
              className="!border-border !bg-card"
              nodeColor={() => "var(--primary)"}
              maskColor="rgba(0, 0, 0, 0.1)"
            />
          </ReactFlow>
        </div>
        {selectedNode && !versionPanelOpen && !testPanelOpen && (
          <NodeConfigSidebar
            flowId={flow.id}
            flowName={flowName}
            attributionDefaults={attributionDefaults}
            node={selectedNode}
            nodes={nodes}
            edges={edges}
            onChange={onNodeDataChange}
            onClose={closeSidebar}
            onDelete={deleteNode}
            onConvert={convertCondition}
            onChangeTrigger={() => setPickerOpen(true)}
          />
        )}
        {versionPanelOpen && (
          <VersionHistoryPanel
            flowId={flow.id}
            currentVersion={flow.version}
            onClose={() => setVersionPanelOpen(false)}
            onRestore={() => router.refresh()}
          />
        )}
        <TriggerPicker
          open={pickerOpen}
          currentKey={choiceKeyFor((triggerNode?.data ?? {}) as Record<string, unknown>)}
          onPick={handlePick}
          // Sin disparador elegido no se puede cerrar: primero se decide como arranca.
          onClose={triggerChosen ? () => setPickerOpen(false) : undefined}
        />
        <FlowDetailsDialog
          open={detailsOpen}
          flowId={flow.id}
          initial={{ ...details, name: flowName }}
          onClose={() => setDetailsOpen(false)}
          onSaved={(saved) => {
            setDetails(saved);
            setFlowName(saved.name);
            router.refresh();
          }}
        />
        {testPanelOpen && (
          <TestPanel
            nodes={nodes}
            edges={edges}
            onClose={() => setTestPanelOpen(false)}
            onHighlightNode={(nodeId) => {
              // Scroll to and highlight the node
              const node = nodes.find((n) => n.id === nodeId);
              if (node) setSelectedNodeId(nodeId);
            }}
          />
        )}
      </div>
    </div>
  );
}

export function FlowCanvas({ flow, attributionDefaults, capabilities = ALL_CONNECTED }: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCapabilitiesProvider capabilities={capabilities}>
        <FlowCanvasInner flow={flow} attributionDefaults={attributionDefaults} />
      </FlowCapabilitiesProvider>
    </ReactFlowProvider>
  );
}
