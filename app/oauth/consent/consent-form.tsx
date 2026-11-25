"use client";

import { useState, useTransition } from "react";
import { approveMcpAuthorization, denyMcpAuthorization } from "@/lib/actions/mcp-connections";

export function ConsentForm(props: {
  authorizationId: string;
  clientName: string;
  clientUri: string | null;
  email: string;
  workspaces: { id: string; name: string }[];
  defaultWorkspaceId: string;
}) {
  const [workspaceId, setWorkspaceId] = useState(props.defaultWorkspaceId);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(allow: boolean) {
    setError(null);
    start(async () => {
      const r = allow
        ? await approveMcpAuthorization({ authorizationId: props.authorizationId, workspaceId })
        : await denyMcpAuthorization({ authorizationId: props.authorizationId });
      if (!r.ok) return setError(r.error);
      window.location.assign(r.redirectUrl);
    });
  }

  return (
    <div className="space-y-5 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="text-base font-semibold">
          {props.clientName} quiere conectarse a tu cuenta
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Entraste como <span className="font-medium text-foreground">{props.email}</span>.
          {props.clientUri ? <> La app es {props.clientUri}.</> : null}
        </p>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Podrá ver y hacer todo lo que tu rol te permite en este negocio: consultar, crear, editar y configurar.</li>
        <li>Lo delicado (borrar, enviar mensajes, invitar, cambiar permisos, publicar) te pide confirmación antes.</li>
        <li>Todo queda en el historial con la marca «MCP». La desconectás cuando quieras en Mi cuenta → Conexiones.</li>
      </ul>

      {props.workspaces.length > 1 ? (
        <div>
          <label htmlFor="mcp-workspace" className="mb-1.5 block text-sm font-medium">
            Negocio
          </label>
          <select
            id="mcp-workspace"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {props.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm">
          Negocio: <span className="font-medium">{props.workspaces[0]?.name}</span>
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => decide(false)}
          disabled={pending}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          Rechazar
        </button>
        <button
          type="button"
          onClick={() => decide(true)}
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Un momento…" : "Permitir"}
        </button>
      </div>
    </div>
  );
}
