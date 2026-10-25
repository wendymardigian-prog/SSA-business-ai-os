"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useActiveWorkspaceId } from "@/components/dashboard-chrome";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeType } from "@/lib/types/database";
import { EnrollSequencePanel } from "./EnrollSequencePanel";
import { SendAssetPanel } from "./SendAssetPanel";
import { CreateTaskPanel } from "./CreateTaskPanel";
import { CompleteTaskPanel } from "./CompleteTaskPanel";
import { SendWhatsAppNumberPanel } from "./SendWhatsAppNumberPanel";
import { SendEmailPanel } from "./SendEmailPanel";
import { CancelBookingPanel, NotifyTeamPanel, SetBookingStatusPanel } from "./ExtraActionPanels";
import { VariableChips } from "./variable-chips";

interface ActionPanelData {
  actionType?: NodeType;
  tagName?: string;
  action?: "add" | "remove";
  fieldSlug?: string;
  value?: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  responseVariable?: string;
  flowId?: string;
  returnAfter?: boolean;
  message?: string;
  paths?: Array<{ name: string; weight: number }>;
  timeout?: number;
  timeoutUnit?: string;
  confirmed?: boolean;
  sequenceId?: string;
  [key: string]: unknown;
}

interface ActionPanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  /** Las variables que el flujo ofrece en este punto (para los campos de texto del paso). */
  availableVariables?: string[];
}

interface ActionSubPanelProps {
  data: ActionPanelData;
  onChange: (data: Record<string, unknown>) => void;
  availableVariables?: string[];
}

export function ActionPanel({ data: rawData, onChange, availableVariables }: ActionPanelProps) {
  const data = rawData as ActionPanelData;
  const actionType = data.actionType || "addTag";

  switch (actionType) {
    case "addTag":
    case "removeTag":
      return <TagConfig data={data} onChange={onChange} availableVariables={availableVariables} />;
    case "setCustomField":
      return <SetFieldConfig data={data} onChange={onChange} availableVariables={availableVariables} />;
    case "httpRequest":
      return <HttpRequestConfig data={data} onChange={onChange} availableVariables={availableVariables} />;
    case "goToFlow":
      return <GoToFlowConfig data={data} onChange={onChange} />;
    case "subscribe":
    case "unsubscribe":
      return <SubscribeConfig data={data} onChange={onChange} />;
    case "humanTakeover":
      return <HumanTakeoverConfig data={data} onChange={onChange} />;
    case "abSplit":
      return <ABSplitConfig data={data} onChange={onChange} />;
    case "smartDelay":
      return <SmartDelayConfig data={data} onChange={onChange} />;
    case "enrollSequence":
      return <EnrollSequencePanel data={rawData} onChange={onChange} />;
    case "sendAsset":
      return <SendAssetPanel data={rawData} onChange={onChange} />;
    case "pauseAgent":
      return <PauseAgentConfig data={data} onChange={onChange} />;
    case "resumeAgent":
      return <ResumeAgentConfig />;
    // Tirón 2, D3: un aviso por WhatsApp a un número que puede no ser de ningún contacto.
    case "send_whatsapp_number" as NodeType:
      return <SendWhatsAppNumberPanel data={rawData} onChange={onChange} availableVariables={availableVariables} />;
    // Etapa 4 (F46) + Tirón 2, D4: el email, ahora también a la dirección de una variable.
    case "send_email" as NodeType:
      return <SendEmailPanel data={rawData} onChange={onChange} availableVariables={availableVariables} />;
    // Tareas (F22): deja una tarea para el equipo.
    case "create_task" as NodeType:
      return <CreateTaskPanel data={rawData} onChange={onChange} availableVariables={availableVariables} />;
    // Tareas × CRM (R4): cierra las tareas abiertas que tienen esa clave de origen.
    case "complete_task" as NodeType:
      return <CompleteTaskPanel data={rawData} onChange={onChange} availableVariables={availableVariables} />;
    // Ventas (F37): trabajan sobre el pago o la venta que disparo el flujo.
    case "mark_payment_paid" as NodeType:
      return <MarkPaymentPaidConfig data={data} onChange={onChange} />;
    case "reschedule_payment" as NodeType:
      return <ReschedulePaymentConfig data={data} onChange={onChange} />;
    case "set_sale_status" as NodeType:
      return <SetSaleStatusConfig data={data} onChange={onChange} />;
    // Antes estos tres no tenian panel en el lienzo: decia "No configuration available" y el paso no hacia nada.
    case "notify_team" as NodeType:
      return <NotifyTeamPanel data={rawData} onChange={onChange} availableVariables={availableVariables} />;
    case "cancel_booking" as NodeType:
      return <CancelBookingPanel data={rawData} onChange={onChange} availableVariables={availableVariables} />;
    case "set_booking_status" as NodeType:
      return <SetBookingStatusPanel data={rawData} onChange={onChange} />;
    default:
      return (
        <p className="text-sm text-muted-foreground">
          Este paso no tiene nada para configurar.
        </p>
      );
  }
}

/* ───────── Tag Config ───────── */
function TagConfig({ data, onChange, availableVariables }: ActionSubPanelProps) {
  const isAdd = data.actionType === "addTag";

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">
          Etiqueta
        </label>
        <input
          type="text"
          value={data.tagName || ""}
          onChange={(e) => onChange({ ...data, tagName: e.target.value })}
          placeholder="Por ejemplo: interesado"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {isAdd
            ? "Se le agrega al contacto cuando llega a este paso. Si la etiqueta no existe, se crea."
            : "Se le quita al contacto cuando llega a este paso."}
        </p>
        <VariableChips variables={availableVariables} onInsert={(token) => onChange({ ...data, tagName: `${data.tagName ?? ""}${token}` })} />
      </div>
    </div>
  );
}

/* ───────── Set Custom Field Config ───────── */
interface FieldOption {
  slug: string;
  name: string;
  type: string;
}

const VALUE_HINTS: Record<string, string> = {
  number: "Un número (3 o 3,5) o una {{variable}}.",
  boolean: "Sí o No, o una {{variable}}.",
  date: "AAAA-MM-DD o DD/MM/AAAA, o una {{variable}}.",
  url: "Una dirección que empiece con https://, o una {{variable}}.",
  email: "Un email, o una {{variable}}.",
};

function SetFieldConfig({ data, onChange, availableVariables }: ActionSubPanelProps) {
  const [fields, setFields] = useState<FieldOption[] | null>(null);
  const workspaceId = useActiveWorkspaceId();

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    // Solo los del negocio activo: la RLS deja ver los de los dos si la persona esta en dos.
    let query = supabase
      .from("custom_field_definitions")
      .select("slug, name, type")
      .is("deleted_at", null);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    void query
      .order("name", { ascending: true })
      .then(({ data: rows }) => {
        if (alive) setFields(rows ?? []);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  const slug = data.fieldSlug || "";
  const selected = fields?.find((f) => f.slug === slug) ?? null;
  // Un slug guardado que ya no existe (campo borrado o tipeado a mano) se sigue viendo.
  const orphan = slug !== "" && fields !== null && !selected;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="set-field-slug" className="mb-2 block text-xs font-semibold text-foreground">
          Campo
        </label>
        {fields === null ? (
          <p className="text-xs text-muted-foreground">Cargando campos…</p>
        ) : fields.length === 0 && !orphan ? (
          <p className="text-xs text-muted-foreground">
            No hay campos personalizados. Se crean en Ajustes → Campos personalizados.
          </p>
        ) : (
          <select
            id="set-field-slug"
            value={slug}
            onChange={(e) => onChange({ ...data, fieldSlug: e.target.value })}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Elegí un campo</option>
            {fields.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.name}
              </option>
            ))}
            {orphan && <option value={slug}>{slug} (ya no existe)</option>}
          </select>
        )}
        {orphan && (
          <p className="mt-1.5 text-[11px] text-destructive">
            Ese campo ya no existe: el paso no va a escribir nada hasta que elijas otro.
          </p>
        )}
      </div>
      <div>
        <label htmlFor="set-field-value" className="mb-2 block text-xs font-semibold text-foreground">
          Valor
        </label>
        <input
          id="set-field-value"
          type="text"
          value={data.value || ""}
          onChange={(e) => onChange({ ...data, value: e.target.value })}
          placeholder="Valor o {{variable}}"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground/60">
          {(selected && VALUE_HINTS[selected.type]) ?? "Un texto o una {{variable}}."} Vacío borra el valor; uno que no
          corresponde al tipo no se guarda.
        </p>
        <VariableChips variables={availableVariables} onInsert={(token) => onChange({ ...data, value: `${data.value ?? ""}${token}` })} />
      </div>
    </div>
  );
}

/* ───────── HTTP Request Config ───────── */
function HttpRequestConfig({ data, onChange, availableVariables }: ActionSubPanelProps) {
  const headers = data.headers || {};
  const headerEntries = Object.entries(headers);

  const addHeader = useCallback(() => {
    onChange({ ...data, headers: { ...headers, "": "" } });
  }, [data, headers, onChange]);

  const updateHeaderKey = useCallback(
    (oldKey: string, newKey: string) => {
      const newHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        newHeaders[k === oldKey ? newKey : k] = v;
      }
      onChange({ ...data, headers: newHeaders });
    },
    [data, headers, onChange]
  );

  const updateHeaderValue = useCallback(
    (key: string, value: string) => {
      onChange({ ...data, headers: { ...headers, [key]: value } });
    },
    [data, headers, onChange]
  );

  const removeHeader = useCallback(
    (key: string) => {
      const newHeaders = { ...headers };
      delete newHeaders[key];
      onChange({ ...data, headers: Object.keys(newHeaders).length > 0 ? newHeaders : undefined });
    },
    [data, headers, onChange]
  );

  return (
    <div className="space-y-4">
      {/* Method + URL */}
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">
          Llamada
        </label>
        <div className="flex gap-2">
          <select
            value={data.method || "GET"}
            onChange={(e) => onChange({ ...data, method: e.target.value })}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input
            type="url"
            value={data.url || ""}
            onChange={(e) => onChange({ ...data, url: e.target.value })}
            placeholder="https://api.ejemplo.com/webhook"
            className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <VariableChips variables={availableVariables} onInsert={(token) => onChange({ ...data, url: `${data.url ?? ""}${token}` })} hint="Tocá una variable para sumarla a la dirección." />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Solo direcciones públicas (http o https). Si no responde en 10 segundos se corta, y se guardan hasta 256 KB de la respuesta.
        </p>
      </div>

      {/* Headers */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">Encabezados (headers)</label>
          <button
            type="button"
            onClick={addHeader}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted"
          >
            <Plus className="h-3 w-3" />
            Agregar
          </button>
        </div>
        {headerEntries.map(([key, value], i) => (
          <div key={i} className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={key}
              onChange={(e) => updateHeaderKey(key, e.target.value)}
              placeholder="Nombre"
              className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="text"
              value={value}
              onChange={(e) => updateHeaderValue(key, e.target.value)}
              placeholder="Valor (acepta {{variables}})"
              className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => removeHeader(key)}
              aria-label="Quitar el encabezado"
              className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Body */}
      {(data.method === "POST" || data.method === "PUT" || data.method === "PATCH" || data.method === "DELETE") && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Cuerpo (JSON)
          </label>
          <textarea
            value={data.body || ""}
            onChange={(e) => onChange({ ...data, body: e.target.value })}
            placeholder='{"key": "{{variable}}"}'
            rows={4}
            className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <VariableChips variables={availableVariables} onInsert={(token) => onChange({ ...data, body: `${data.body ?? ""}${token}` })} hint="Tocá una variable para sumarla al cuerpo." />
        </div>
      )}

      {/* Response Variable */}
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">
          Guardar la respuesta en la variable
        </label>
        <input
          type="text"
          value={data.responseVariable || ""}
          onChange={(e) => onChange({ ...data, responseVariable: e.target.value })}
          placeholder="por ejemplo: respuesta_api"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Opcional. Los pasos siguientes la leen como {"{{respuesta_api.campo}}"}; además quedan {"{{respuesta_api_status}}"} (el código) y {"{{respuesta_api_ok}}"} («true» si salió bien).
        </p>
      </div>
    </div>
  );
}

/* ───────── Ir a otra automatización ───────── */
function GoToFlowConfig({ data, onChange }: ActionSubPanelProps) {
  // Antes se escribia el id a mano. Ahora se elige de las automatizaciones del negocio ACTIVO (la RLS decide cuales ve).
  const [flows, setFlows] = useState<Array<{ id: string; name: string; status: string }> | null>(null);
  const workspaceId = useActiveWorkspaceId();
  useEffect(() => {
    let alive = true;
    let query = createClient().from("flows").select("id, name, status");
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    void query
      .order("name", { ascending: true })
      .limit(500)
      .then(({ data: rows }) => {
        if (alive) setFlows((rows ?? []) as Array<{ id: string; name: string; status: string }>);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId]);
  const selected = flows?.find((f) => f.id === data.flowId);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="goto-flow" className="mb-2 block text-xs font-semibold text-foreground">
          Automatización
        </label>
        {flows === null ? (
          <p className="text-xs text-muted-foreground">Cargando automatizaciones…</p>
        ) : (
          <select
            id="goto-flow"
            value={data.flowId || ""}
            onChange={(e) => onChange({ ...data, flowId: e.target.value })}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Elegí una automatización</option>
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.status !== "published" ? " (no publicada)" : ""}
              </option>
            ))}
            {data.flowId && !selected && <option value={data.flowId}>(ya no existe)</option>}
          </select>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">
          Esta automatización termina y el contacto sigue en la elegida, que tiene que estar publicada. Un salto que
          vuelve a una que ya pasó (un ciclo) se corta solo.
        </p>
      </div>
    </div>
  );
}

/* ───────── Suscribir / Desuscribir ───────── */
function SubscribeConfig({ data }: ActionSubPanelProps) {
  const isSubscribe = data.actionType === "subscribe";
  return (
    <div className="rounded-lg border border-border bg-muted p-4">
      <p className="text-sm font-medium text-foreground">{isSubscribe ? "Suscribir al contacto" : "Desuscribir al contacto"}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {isSubscribe
          ? "Lo marca como suscripto: vuelve a recibir mensajes masivos y automáticos."
          : "Lo marca como no suscripto: deja de recibir mensajes masivos y la mayoría de los automáticos."}
      </p>
    </div>
  );
}

/* ───────── Agente de IA (Fase 3) ───────── */
function PauseAgentConfig({ data, onChange }: ActionSubPanelProps) {
  const minutes = typeof data.minutes === "number" ? data.minutes : "";
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted p-4">
        <p className="text-sm font-medium text-foreground">Pausar el agente de IA en esta conversación</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Mientras la automatización hace su parte, el agente no responde. Usá &ldquo;Reanudar agente IA&rdquo; al final para devolverle la
          conversación. No cambia el interruptor del agente de la bandeja.
        </p>
      </div>
      <div>
        <label htmlFor="pause-agent-minutes" className="mb-2 block text-xs font-semibold text-foreground">
          Minutos de pausa (opcional)
        </label>
        <input
          id="pause-agent-minutes"
          type="number"
          min={1}
          max={43200}
          value={minutes}
          onChange={(e) =>
            onChange({ ...data, minutes: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })
          }
          placeholder="Hasta que se reanude"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Vacío: queda pausado hasta que una automatización lo reanude. Con minutos: se reanuda solo al vencer.
        </p>
      </div>
    </div>
  );
}

function ResumeAgentConfig() {
  return (
    <div className="rounded-lg border border-border bg-muted p-4">
      <p className="text-sm font-medium text-foreground">Reanudar el agente de IA</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Levanta la pausa que puso una automatización. Si nadie había encendido el agente en esta conversación, sigue apagado.
      </p>
    </div>
  );
}

/* ───────── Human Takeover Config ───────── */
function HumanTakeoverConfig({ data, onChange }: ActionSubPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted p-4">
        <p className="text-sm font-medium text-foreground">Derivar a una persona</p>
        <p className="mt-1 text-xs text-muted-foreground">
          La automatización termina, la conversación queda marcada para que la atienda alguien del equipo y el bot no
          vuelve a responder hasta que la retomen.
        </p>
      </div>

      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">
          Nota interna (opcional)
        </label>
        <textarea
          value={data.message || ""}
          onChange={(e) => onChange({ ...data, message: e.target.value })}
          placeholder="Contexto para quien la tome…"
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Queda en el aviso que recibe el equipo. No se le manda al contacto.
        </p>
      </div>
    </div>
  );
}

/* ───────── A/B Split Config ───────── */
function ABSplitConfig({ data, onChange }: ActionSubPanelProps) {
  const paths = data.paths || [
    { name: "A", weight: 50 },
    { name: "B", weight: 50 },
  ];

  const totalWeight = paths.reduce((sum, p) => sum + p.weight, 0);

  const updatePath = useCallback(
    (index: number, updated: { name: string; weight: number }) => {
      const newPaths = [...paths];
      newPaths[index] = updated;
      onChange({ ...data, paths: newPaths });
    },
    [data, paths, onChange]
  );

  const addPath = useCallback(() => {
    onChange({ ...data, paths: [...paths, { name: String.fromCharCode(65 + paths.length), weight: 0 }] });
  }, [data, paths, onChange]);

  const removePath = useCallback(
    (index: number) => {
      if (paths.length <= 2) return;
      onChange({ ...data, paths: paths.filter((_, i) => i !== index) });
    },
    [data, paths, onChange]
  );

  const distributeEvenly = useCallback(() => {
    const evenWeight = Math.floor(100 / paths.length);
    const remainder = 100 - evenWeight * paths.length;
    const newPaths = paths.map((p, i) => ({
      ...p,
      weight: evenWeight + (i === 0 ? remainder : 0),
    }));
    onChange({ ...data, paths: newPaths });
  }, [data, paths, onChange]);

  return (
    <div className="space-y-4">
      {/* Distribution bar */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">
            Reparto
          </label>
          <button
            type="button"
            onClick={distributeEvenly}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Repartir parejo
          </button>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted">
          {paths.map((path, i) => {
            const colors = [
              "bg-blue-500",
              "bg-emerald-500",
              "bg-amber-500",
              "bg-purple-500",
              "bg-rose-500",
            ];
            return (
              <div
                key={i}
                className={cn("transition-all", colors[i % colors.length])}
                style={{ width: `${totalWeight > 0 ? (path.weight / totalWeight) * 100 : 0}%` }}
              />
            );
          })}
        </div>
        {totalWeight !== 100 && (
          <p className="mt-1 text-[11px] font-medium text-red-500">
            Suman {totalWeight}% (tienen que sumar 100%)
          </p>
        )}
      </div>

      {/* Paths */}
      <div className="space-y-2">
        {paths.map((path, index) => {
          const colors = [
            "border-l-blue-500",
            "border-l-emerald-500",
            "border-l-amber-500",
            "border-l-purple-500",
            "border-l-rose-500",
          ];
          return (
            <div
              key={index}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-border border-l-4 bg-card p-3",
                colors[index % colors.length]
              )}
            >
              <input
                type="text"
                value={path.name}
                aria-label="Nombre del camino"
                onChange={(e) => updatePath(index, { ...path, name: e.target.value })}
                className="w-16 rounded border border-border bg-muted px-2 py-1.5 text-xs font-medium text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="range"
                min={0}
                max={100}
                aria-label={`Peso del camino ${path.name}`}
                value={path.weight}
                onChange={(e) =>
                  updatePath(index, { ...path, weight: parseInt(e.target.value) })
                }
                className="flex-1 accent-muted-foreground"
              />
              <span className="w-10 text-right text-xs font-semibold text-foreground">
                {path.weight}%
              </span>
              {paths.length > 2 && (
                <button
                  type="button"
                  onClick={() => removePath(index)}
                  aria-label="Quitar el camino"
                  className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {paths.length < 5 && (
        <button
          type="button"
          onClick={addPath}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-muted-foreground hover:text-muted-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Agregar camino
        </button>
      )}
    </div>
  );
}

/* ───────── Esperar respuesta ───────── */
function SmartDelayConfig({ data, onChange }: ActionSubPanelProps) {
  // Un nodo viejo con un tiempo guardado y sin el interruptor: el tiempo vale (es lo que el panel prometia).
  const enabled = typeof data.timeoutEnabled === "boolean" ? data.timeoutEnabled : data.timeout !== undefined && data.timeout !== null;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted p-4">
        <p className="text-sm font-medium text-foreground">Esperar respuesta</p>
        <p className="mt-1 text-xs text-muted-foreground">
          La automatización frena hasta que el contacto conteste y sigue por «Respondió». Sin tiempo máximo, la espera
          vence a los 7 días y la automatización termina (así una respuesta de semanas después no queda atrapada).
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ ...data, timeoutEnabled: e.target.checked, timeout: data.timeout ?? 24, timeoutUnit: data.timeoutUnit ?? "hours" })}
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        <span>
          <span className="font-medium text-foreground">Si no responde a tiempo, seguir igual</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Al vencer, sigue por la salida «No respondió». Si esa salida no está conectada, sigue por «Respondió».
          </span>
        </span>
      </label>

      {enabled && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">Tiempo máximo</label>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              aria-label="Cantidad"
              value={data.timeout ?? 24}
              onChange={(e) => onChange({ ...data, timeoutEnabled: true, timeout: Math.max(1, parseInt(e.target.value) || 1) })}
              className="w-24 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <select
              aria-label="Unidad"
              value={data.timeoutUnit || "hours"}
              onChange={(e) => onChange({ ...data, timeoutEnabled: true, timeoutUnit: e.target.value })}
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="minutes">Minutos</option>
              <option value="hours">Horas</option>
              <option value="days">Días</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── Ventas (F37) ───────── */
const salesInput = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";

function MarkPaymentPaidConfig({ data, onChange }: ActionSubPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted p-4">
        <p className="text-sm font-medium text-foreground">Marcar el pago como cobrado</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Cobra el pago que disparó la automatización, por su monto programado y con la fecha de hoy. No sube comprobante. Queda en el historial como una acción de la automatización.
        </p>
      </div>
      <div>
        <label htmlFor="mpp-method" className="mb-2 block text-xs font-semibold text-foreground">Método de cobro</label>
        <select id="mpp-method" value={(data.method as string | undefined) ?? ""} onChange={(e) => onChange({ ...data, method: e.target.value })} className={salesInput}>
          <option value="">El primer método habilitado</option>
          <option value="whop">Whop (registrado a mano)</option>
          <option value="transferencia_cr">Transferencia CR</option>
          <option value="transferencia_usa">Transferencia USA</option>
          <option value="wise">Wise</option>
          <option value="binance">Binance</option>
        </select>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card p-3">
        <input type="checkbox" checked={data.confirmed === true} onChange={(e) => onChange({ ...data, confirmed: e.target.checked })} className="mt-0.5 h-4 w-4 rounded border-input" />
        <span className="text-sm text-foreground">Entiendo que esto marca el pago como cobrado sin comprobante. Sin esta confirmación el paso no hace nada.</span>
      </label>
    </div>
  );
}

function ReschedulePaymentConfig({ data, onChange }: ActionSubPanelProps) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="rp-days" className="mb-2 block text-xs font-semibold text-foreground">Días a sumar al vencimiento</label>
        <input id="rp-days" type="number" min={1} max={90} value={typeof data.days === "number" ? data.days : ""} onChange={(e) => onChange({ ...data, days: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="7" className={salesInput} />
      </div>
      <div>
        <label htmlFor="rp-reason" className="mb-2 block text-xs font-semibold text-foreground">Motivo (queda en el historial)</label>
        <input id="rp-reason" type="text" value={(data.reason as string | undefined) ?? ""} onChange={(e) => onChange({ ...data, reason: e.target.value })} placeholder="Reprogramado por una automatización" className={salesInput} />
      </div>
      <p className="text-xs text-muted-foreground">El vencimiento original no cambia: el desfase se mide contra él.</p>
    </div>
  );
}

function SetSaleStatusConfig({ data, onChange }: ActionSubPanelProps) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="ss-status" className="mb-2 block text-xs font-semibold text-foreground">Pasar la venta a</label>
        <select id="ss-status" value={(data.status as string | undefined) ?? ""} onChange={(e) => onChange({ ...data, status: e.target.value })} className={salesInput}>
          <option value="">Elegí un estado</option>
          <option value="cancelled">Cancelada</option>
          <option value="subscription_cancelled">Suscripción dada de baja</option>
        </select>
      </div>
      <div>
        <label htmlFor="ss-reason" className="mb-2 block text-xs font-semibold text-foreground">Motivo</label>
        <input id="ss-reason" type="text" value={(data.reason as string | undefined) ?? ""} onChange={(e) => onChange({ ...data, reason: e.target.value })} placeholder="Cambiado por una automatización" className={salesInput} />
      </div>
      <p className="text-xs text-muted-foreground">Cancelar es definitivo: no se vuelve atrás. Los pagos programados y morosos se anulan y lo ya cobrado se conserva.</p>
    </div>
  );
}
