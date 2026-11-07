"use client";

import { createContext, Suspense, use, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchChatBlock } from "@/lib/dashboards/chat/block-client";
import type { ChatBlockData, ChatBlockKey } from "@/lib/dashboards/chat/block-keys";
import type { BlockResult } from "@/lib/dashboards/chat/types";

/**
 * Un bloque del dashboard: se pide solo, se muestra cuando llega, y si falla lo
 * dice sin arrastrar a los demas.
 *
 * El servidor arma una promesa por bloque y las manda sin esperarlas; aca cada
 * una se lee con `use()` adentro de su propio `Suspense`. Mientras llega se ve
 * su skeleton. Los loaders nunca rechazan (ver lib/dashboards/chat/result.ts),
 * asi que `use()` no puede tirar la pantalla abajo.
 *
 * "Reintentar" vuelve a pedir SOLO ese bloque. Antes rehacia la pantalla entera:
 * si la base estaba saturada, cada reintento le sumaba todas las consultas de nuevo.
 *
 * Quien usa `Block` le pone un `key` con los filtros: un `Suspense` nuevo muestra su
 * skeleton aunque el cambio venga en una transicion, en vez de dejar los numeros
 * viejos a la vista hasta que llegue el bloque mas lento.
 */

/** Los filtros como los tiene la URL: lo que necesita un bloque para volver a pedirse. */
export const ChatBlockQueryContext = createContext<string>("");

export function Block<K extends ChatBlockKey>({
  block,
  promise,
  label,
  skeleton,
  children,
}: {
  block: K;
  promise: Promise<BlockResult<ChatBlockData[K]>>;
  /** Como se llama el bloque en el mensaje de error. */
  label: string;
  /** `null` = no mostrar nada mientras llega. Sin pasarlo, el panel generico. */
  skeleton?: ReactNode;
  children: (data: ChatBlockData[K], loadedAt: string) => ReactNode;
}) {
  return (
    <Suspense fallback={<BlockFallback skeleton={skeleton} />}>
      <Resolved block={block} promise={promise} label={label}>
        {children}
      </Resolved>
    </Suspense>
  );
}

/**
 * Lo que se ve mientras el bloque viaja, con el aviso de demora.
 *
 * El aviso aparece solo por CSS (`.chat-slow-hint`): en la primera carga, un
 * fallback que llega en streaming no se hidrata, asi que un `setTimeout` de React
 * no correria nunca, que es justo cuando mas tarda.
 */
function BlockFallback({ skeleton }: { skeleton?: ReactNode }) {
  if (skeleton === null) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {skeleton === undefined ? <BlockSkeleton /> : skeleton}
      <p role="status" className="chat-slow-hint text-xs text-muted-foreground">
        Esto está tardando más de lo normal. Seguimos buscando los datos…
      </p>
    </div>
  );
}

function Resolved<K extends ChatBlockKey>({
  block,
  promise,
  label,
  children,
}: {
  block: K;
  promise: Promise<BlockResult<ChatBlockData[K]>>;
  label: string;
  children: (data: ChatBlockData[K], loadedAt: string) => ReactNode;
}) {
  const query = useContext(ChatBlockQueryContext);
  // Lo reintentado vale solo para la promesa que fallo: si despues la pagina manda
  // otra, manda la nueva.
  const [retry, setRetry] = useState<{ forPromise: typeof promise; result: BlockResult<ChatBlockData[K]> | null } | null>(null);
  const current = retry?.forPromise === promise ? retry : null;
  const loaded = use(promise);
  const result = current?.result ?? loaded;

  if (!result.ok) {
    return (
      <BlockError
        label={label}
        error={result.error}
        pending={current !== null && current.result === null}
        onRetry={() => {
          setRetry({ forPromise: promise, result: null });
          void fetchChatBlock(block, query, { fresh: true }).then((next) => setRetry({ forPromise: promise, result: next }));
        }}
      />
    );
  }
  return <>{children(result.data, result.loadedAt)}</>;
}

/**
 * Un bloque que se pide recien cuando esta por entrar en pantalla.
 *
 * Los de abajo de todo casi nunca se llegan a mirar antes de cambiar un filtro: no
 * tiene sentido pagarlos en cada carga. Se cancela solo si cambian los filtros o se
 * desmonta, y sin `IntersectionObserver` se pide enseguida.
 *
 * `refreshToken`: cuando cambia, vuelve a pedir sin sacar lo que se esta viendo (una
 * correccion de categorias no tiene por que hacer parpadear la tabla).
 */
export function DeferredBlock<K extends ChatBlockKey>({
  block,
  label,
  skeleton,
  refreshToken,
  children,
}: {
  block: K;
  label: string;
  skeleton?: ReactNode;
  refreshToken?: number;
  children: (data: ChatBlockData[K], loadedAt: string) => ReactNode;
}) {
  const query = useContext(ChatBlockQueryContext);
  const anchor = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<BlockResult<ChatBlockData[K]> | null>(null);
  // El contador de "Reintentar": el primer pedido puede usar lo guardado, el resto no.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (visible || !anchor.current) return;
    const element = anchor.current;
    if (typeof IntersectionObserver === "undefined") {
      const timer = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { root: element.closest("[data-dashboard-scroll]"), rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    void fetchChatBlock(block, query, { fresh: attempt > 0, signal: controller.signal }).then((next) => {
      if (!controller.signal.aborted) setResult(next);
    });
    return () => controller.abort();
  }, [visible, block, query, attempt, refreshToken]);

  if (result?.ok) return <>{children(result.data, result.loadedAt)}</>;
  if (result) {
    return (
      <BlockError
        label={label}
        error={result.error}
        pending={false}
        onRetry={() => {
          setResult(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return (
    <div ref={anchor}>
      <DeferredFallback skeleton={skeleton} waiting={visible} />
    </div>
  );
}

/** Antes de que se pida no hay nada demorado: el aviso corre recien con el pedido en camino. */
function DeferredFallback({ skeleton, waiting }: { skeleton?: ReactNode; waiting: boolean }) {
  if (waiting) return <BlockFallback skeleton={skeleton} />;
  if (skeleton === null) return <div className="h-px" aria-hidden />;
  return <>{skeleton === undefined ? <BlockSkeleton /> : skeleton}</>;
}

/** El error de un bloque: que falló y como volver a intentarlo. Nunca un 0. */
export function BlockError({
  label,
  error,
  pending,
  onRetry,
}: {
  label: string;
  error: string;
  pending: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-[14px] border border-dashed border-bad/50 bg-card p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0 text-bad" aria-hidden />
        No pudimos mostrar {label}
      </p>
      <p className="text-xs text-muted-foreground">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={pending}
        className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", pending && "animate-spin")} aria-hidden />
        {pending ? "Reintentando…" : "Reintentar"}
      </button>
    </div>
  );
}

/** Lo que se ve mientras el bloque viaja. Con la forma de lo que va a venir. */
export function BlockSkeleton({
  kind = "panel",
  className,
}: {
  kind?: "panel" | "kpis" | "chart" | "table" | "cards3";
  className?: string;
}) {
  const bar = "animate-pulse rounded bg-muted";
  if (kind === "kpis") {
    return (
      <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-5", className)} aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-[14px] border border-border bg-card p-4">
            <div className={cn(bar, "h-3 w-3/5")} />
            <div className={cn(bar, "mt-2 h-6 w-2/5")} />
            <div className={cn(bar, "mt-2 h-2.5 w-4/5")} />
          </div>
        ))}
      </div>
    );
  }
  if (kind === "cards3") {
    return (
      <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-3", className)} aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-[14px] border border-border bg-card p-4">
            <div className={cn(bar, "h-3 w-1/2")} />
            <div className={cn(bar, "mt-3 h-8 w-2/5")} />
            <div className={cn(bar, "mt-2 h-2.5 w-3/4")} />
          </div>
        ))}
      </div>
    );
  }
  const bodyHeight = kind === "chart" ? "h-[240px]" : kind === "table" ? "h-[180px]" : "h-[120px]";
  return (
    <div className={cn("rounded-[14px] border border-border bg-card p-4", className)} aria-hidden>
      <div className={cn(bar, "h-4 w-48 max-w-full")} />
      <div className={cn(bar, "mt-4", bodyHeight)} />
    </div>
  );
}

/**
 * Una tarjeta. Radio de 14 px y fondo de superficie sobre el fondo de pagina,
 * como el prototipo.
 */
export function Panel({
  title,
  subtitle,
  actions,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Pestañas, leyenda o un link, a la derecha del titulo. */
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-[14px] border border-border bg-card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-[18px] pb-1.5 pt-4">
          {title && <h3 className="text-[15px] font-semibold">{title}</h3>}
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
      {footer && (
        <footer className="flex flex-wrap justify-between gap-2 border-t border-border px-[18px] py-2.5 text-xs text-muted-foreground">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** El encabezado de una seccion: mayusculas, subtitulo y un link a la derecha. */
export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{title}</h2>
      {subtitle && <p className="text-xs text-muted-foreground/80">{subtitle}</p>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

/** Un bloque sin datos: explica y ofrece algo, nunca un cero. */
export function EmptyBlock({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-[14px] border border-border bg-card px-5 py-14 text-center">
      {icon && <div className="grid h-13 w-13 place-items-center rounded-[14px] bg-muted p-3 text-muted-foreground">{icon}</div>}
      <h3 className="text-base font-medium">{title}</h3>
      {text && <p className="max-w-[52ch] text-sm text-muted-foreground">{text}</p>}
      {action}
    </div>
  );
}
