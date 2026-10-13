"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { DEFAULT_MAX_LEAVES, leafTypeOf } from "@/lib/webhooks/payload-tree";

/**
 * Un arbol JSON plegable (webhooks entrantes). Lo usan el historial, el ejemplo del endpoint y,
 * con `onPick`, el selector de variables y el mapeo (la hoja es un boton que devuelve su ruta).
 *
 * Los valores se pintan como TEXTO de React (escapado): el payload viene de afuera y nunca va a
 * `dangerouslySetInnerHTML`. Tiene tope de hojas con "ver mas" para no colgar la pantalla con un
 * payload enorme.
 */
type Json = unknown;

const isBranch = (v: Json): v is Record<string, Json> | Json[] => typeof v === "object" && v !== null;

function entries(v: Record<string, Json> | Json[]): [string, Json][] {
  return Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v);
}

/** Las rutas de todas las hojas, en el orden en que se pintan (para aplicar el tope sin mutar nada). */
function leafPaths(value: Json, path: string, out: string[]): void {
  if (!isBranch(value)) {
    out.push(path);
    return;
  }
  for (const [key, child] of entries(value)) leafPaths(child, path ? `${path}.${key}` : key, out);
}

export function JsonTree({
  value,
  onPick,
  maxLeaves = DEFAULT_MAX_LEAVES,
  rootPath = "",
}: {
  value: Json;
  /** Si viene, cada hoja es clickeable y devuelve su ruta (relativa a `rootPath`). */
  onPick?: (path: string, sample: string) => void;
  maxLeaves?: number;
  /** Prefijo que se antepone a la ruta que devuelve `onPick`. */
  rootPath?: string;
}) {
  const [limit, setLimit] = useState(maxLeaves);

  if (!isBranch(value)) {
    return <p className="font-mono text-xs text-muted-foreground">{value === null || value === undefined ? "(vacío)" : String(value)}</p>;
  }
  if (entries(value).length === 0) return <p className="text-xs text-muted-foreground">(vacío)</p>;

  const all: string[] = [];
  leafPaths(value, "", all);
  const visible = new Set(all.slice(0, limit));
  const hidden = Math.max(0, all.length - limit);

  return (
    <div>
      <ul className="space-y-0.5 font-mono text-xs">
        {entries(value).map(([key, child]) => (
          <TreeNode key={key} name={key} value={child} path={key} depth={1} visible={visible} onPick={onPick} rootPath={rootPath} />
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" onClick={() => setLimit((l) => l + maxLeaves)} className="mt-2 text-xs font-medium text-primary hover:underline">
          Ver más ({hidden} más)
        </button>
      )}
    </div>
  );
}

function TreeNode({
  name, value, path, depth, visible, onPick, rootPath,
}: {
  name: string; value: Json; path: string; depth: number; visible: ReadonlySet<string>;
  onPick?: (path: string, sample: string) => void; rootPath: string;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (isBranch(value)) {
    const children = entries(value);
    const count = children.length;
    return (
      <li>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1 text-left hover:text-foreground">
          {open ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
          <span className="font-semibold">{name}</span>
          <span className="text-muted-foreground">{Array.isArray(value) ? `[${count}]` : `{${count}}`}</span>
        </button>
        {open && (
          <ul className="ml-3 space-y-0.5 border-l border-border pl-2">
            {children.map(([k, v]) => (
              <TreeNode key={k} name={k} value={v} path={`${path}.${k}`} depth={depth + 1} visible={visible} onPick={onPick} rootPath={rootPath} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  if (!visible.has(path)) return null;

  const text = value === null || value === undefined ? "null" : String(value);
  const kind = typeof value === "string" ? leafTypeOf(value) : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text";
  const full = rootPath ? `${rootPath}.${path}` : path;
  const body = (
    <>
      <span className="font-semibold">{name}</span>
      <span className="text-muted-foreground">: </span>
      <span className={kind === "number" ? "text-sky-600 dark:text-sky-400" : kind === "boolean" ? "text-violet-600 dark:text-violet-400" : "text-foreground"}>
        {typeof value === "string" ? `"${text.length > 120 ? `${text.slice(0, 120)}…` : text}"` : text}
      </span>
    </>
  );

  return (
    <li className="group flex items-start gap-1 break-all">
      {onPick ? (
        <button type="button" onClick={() => onPick(full, text)} className="rounded px-1 text-left hover:bg-accent" title={`Usar ${full}`}>
          {body}
        </button>
      ) : (
        <span className="px-1">{body}</span>
      )}
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(text).catch(() => {})}
        aria-label={`Copiar el valor de ${name}`}
        className="invisible shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent group-hover:visible focus:visible"
      >
        <Copy className="h-3 w-3" aria-hidden />
      </button>
    </li>
  );
}
