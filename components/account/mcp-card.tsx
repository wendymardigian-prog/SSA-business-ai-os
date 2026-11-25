"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeMcpConnectionWorkspace, disconnectMcpConnection } from "@/lib/actions/mcp-connections";
import type { McpConnectionView } from "@/lib/mcp/connection-types";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { formatDateTime } from "@/components/contacts/ui";

/**
 * Mi cuenta → Conexiones: conectar Claude (u otra app) por MCP (docs/mcp.md). Solo se dibuja con «Usar el MCP».
 * La dirección es la misma para todo el equipo: a cada persona la identifica su usuario al conectar, no la dirección.
 */
export function McpCard({ url, cliName, connections, workspaces }: { url: string; cliName: string; connections: McpConnectionView[]; workspaces: { id: string; name: string }[] }) {
  const router = useRouter();
  const tz = useViewerTimezone();
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ tone: "error", text: "No pude copiarla: seleccionala y copiala a mano." });
    }
  }

  function disconnect(id: string, name: string) {
    if (!window.confirm(`¿Desconectar ${name}? La app pierde el acceso al instante.`)) return;
    setMessage(null);
    start(async () => {
      const r = await disconnectMcpConnection({ connectionId: id });
      setMessage(r.ok ? { tone: "success", text: `${name} quedó desconectada.` } : { tone: "error", text: r.error });
      if (r.ok) router.refresh();
    });
  }

  function changeWorkspace(id: string, workspaceId: string) {
    setMessage(null);
    start(async () => {
      const r = await changeMcpConnectionWorkspace({ connectionId: id, workspaceId });
      setMessage(r.ok ? { tone: "success", text: "Negocio cambiado: vale desde el próximo pedido de la app." } : { tone: "error", text: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold">Conectar Claude (MCP)</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Desde Claude (u otra app compatible con MCP) podés consultar, crear, editar y configurar todo lo que tu rol te permite. Lo delicado te pide confirmación y todo queda en el historial.
      </p>

      <div className="mt-4">
        <label htmlFor="mcp-url" className="mb-1 block text-xs font-medium">
          Dirección del conector
        </label>
        <div className="flex gap-2">
          <input id="mcp-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-1.5 font-mono text-xs" />
          <button type="button" onClick={copy} className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
            {copied ? "Copiada" : "Copiar"}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Es la misma para todo el equipo: al conectar, cada persona entra con su propio usuario.</p>
      </div>

      <details className="mt-4 text-xs">
        <summary className="cursor-pointer font-medium">Cómo conectarlo</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Claude (web o escritorio):</span> Configuración → Conectores → Agregar conector personalizado. Pegá la dirección y tocá «Conectar».
          </li>
          <li>
            <span className="font-medium text-foreground">Claude Code:</span> en la terminal, <code className="rounded bg-muted px-1 py-0.5">claude mcp add --transport http {cliName} {url}</code> y después <code className="rounded bg-muted px-1 py-0.5">/mcp</code> para entrar.
          </li>
          <li>Se abre una página del sistema: entrá con tu usuario si hace falta, elegí el negocio y tocá «Permitir».</li>
        </ol>
      </details>

      <div className="mt-4">
        <h4 className="text-xs font-semibold">Apps conectadas</h4>
        {connections.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">Todavía no conectaste ninguna.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="font-medium">{c.clientName}</p>
                  <p className="text-muted-foreground">
                    Conectada el {formatDateTime(c.createdAt, tz)}
                    {c.lastUsedAt ? ` · último uso ${formatDateTime(c.lastUsedAt, tz)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {workspaces.length > 1 ? (
                    <select
                      aria-label={`Negocio de ${c.clientName}`}
                      value={c.workspaceId}
                      disabled={pending}
                      onChange={(e) => changeWorkspace(c.id, e.target.value)}
                      className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                    >
                      {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-muted-foreground">{c.workspaceName}</span>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => disconnect(c.id, c.clientName)}
                    className="rounded-lg border border-border px-2.5 py-1 font-medium hover:bg-muted disabled:opacity-50"
                  >
                    Desconectar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 text-xs ${message.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
