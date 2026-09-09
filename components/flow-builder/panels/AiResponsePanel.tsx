"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { listAiProviders } from "@/lib/actions/integrations";

interface AiResponsePanelData {
  systemPrompt?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  contextMessages?: number;
  sendDirectly?: boolean;
  [key: string]: unknown;
}

interface ConnectedProvider {
  provider: string;
  label: string;
  defaultModel: string;
  models: string[];
}

interface AiResponsePanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

/**
 * Configuracion del nodo de IA.
 *
 * Antes era un campo de texto libre donde habia que escribir "proveedor/modelo"
 * a mano, contra el AI Gateway de Vercel. Un error de tipeo no se notaba hasta
 * que el flow corria en produccion.
 *
 * Ahora se elige entre los proveedores que estan realmente conectados (BYOK,
 * con la key en Vault). Si no hay ninguno, se dice y se explica donde
 * conectarlo, en vez de dejar configurar algo que no va a funcionar.
 */
export function AiResponsePanel({ data: rawData, onChange }: AiResponsePanelProps) {
  const data = rawData as AiResponsePanelData;
  const [providers, setProviders] = useState<ConnectedProvider[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAiProviders()
      .then((list) => {
        if (!cancelled) setProviders(list);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected =
    providers?.find((p) => p.provider === data.provider) ?? providers?.[0];

  return (
    <div className="space-y-4">
      {/* Proveedor y modelo */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Proveedor de IA
        </label>

        {providers === null && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Buscando proveedores conectados...
          </div>
        )}

        {providers?.length === 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <p>
              <span className="font-medium">
                No hay ningun proveedor de IA conectado.
              </span>{" "}
              Este nodo no va a poder generar respuestas hasta que conectes uno
              en Ajustes &gt; Integraciones. El resto del flow funciona igual.
            </p>
          </div>
        )}

        {providers && providers.length > 0 && (
          <>
            <select
              value={selected?.provider ?? ""}
              onChange={(e) => {
                const next = providers.find((p) => p.provider === e.target.value);
                onChange({
                  ...data,
                  provider: e.target.value,
                  // Al cambiar de proveedor, el modelo anterior deja de existir.
                  model: next?.defaultModel,
                });
              }}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {providers.map((p) => (
                <option key={p.provider} value={p.provider}>
                  {p.label}
                </option>
              ))}
            </select>

            <label className="mb-1.5 mt-3 block text-xs font-medium text-muted-foreground">
              Modelo
            </label>
            <select
              value={data.model ?? selected?.defaultModel ?? ""}
              onChange={(e) => onChange({ ...data, model: e.target.value })}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {(selected?.models ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Se usa tu propia cuenta: el consumo se factura ahi.
            </p>
          </>
        )}
      </div>

      {/* Instrucciones */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Instrucciones
        </label>
        <textarea
          value={data.systemPrompt || ""}
          onChange={(e) => onChange({ ...data, systemPrompt: e.target.value })}
          placeholder="Sos el asistente de una agencia de marketing. Responde breve, en español rioplatense..."
          rows={8}
          className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          Como tiene que comportarse y responder la IA.
        </p>
      </div>

      {/* Temperatura */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Creatividad</label>
          <span className="text-xs text-muted-foreground">{data.temperature ?? 0.7}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={data.temperature ?? 0.7}
          onChange={(e) => onChange({ ...data, temperature: parseFloat(e.target.value) })}
          className="w-full"
        />
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground/60">
          <span>Precisa</span>
          <span>Creativa</span>
        </div>
      </div>

      {/* Largo maximo */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Largo maximo de la respuesta
        </label>
        <input
          type="number"
          value={data.maxTokens ?? 500}
          onChange={(e) => onChange({ ...data, maxTokens: parseInt(e.target.value) || 500 })}
          min={1}
          max={4096}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          En tokens. 500 alcanza para un par de parrafos.
        </p>
      </div>

      {/* Mensajes de contexto */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Mensajes de contexto
        </label>
        <input
          type="number"
          value={data.contextMessages ?? 10}
          onChange={(e) => onChange({ ...data, contextMessages: parseInt(e.target.value) || 10 })}
          min={1}
          max={50}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          Cuantos mensajes anteriores de la conversacion se le pasan a la IA.
        </p>
      </div>

      {/* Envio automatico */}
      <div>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            checked={data.sendDirectly ?? true}
            onChange={(e) => onChange({ ...data, sendDirectly: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-border text-blue-500 focus:ring-blue-500"
          />
          Enviar la respuesta automaticamente
        </label>
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          La respuesta siempre queda disponible para los nodos siguientes como{" "}
          {"{{ai_response}}"}. Desactivalo si preferis mandarla vos con un nodo
          Enviar mensaje.
        </p>
      </div>
    </div>
  );
}
