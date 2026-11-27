"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { matchesInboxRow, needsServerToFilter, type InboxFilters } from "@/lib/inbox/filters";
import type { DateRange } from "@/lib/dates";
import type { Database } from "@/lib/types/database";
import type { ConversationRow } from "@/lib/inbox/types";
import { isAfterCursor, type ListCursor } from "@/lib/inbox/list-cursor";
import {
  appendChunk,
  applyFetchedRows,
  mergeFreshFirstChunk,
  mergeVisibleUpdate,
  type LoadedList,
} from "@/lib/inbox/list-merge";
import { loadConversationsByIds, loadMoreConversations } from "@/lib/actions/inbox-list";

/**
 * La lista de la bandeja: de a tandas al bajar y al dia en vivo (27/11/2026).
 *
 * Antes, cualquier cambio en cualquier conversacion del negocio que no fuera una
 * fila a la vista volvia a pedir la PAGINA ENTERA (unas diez consultas, con la
 * banca de recursos completa), en cada pestaña abierta. Ahora:
 *
 * - Un cambio en una fila a la vista que sigue cumpliendo los filtros se aplica
 *   en el acto, sin preguntar nada (un mensaje nuevo la sube arriba).
 * - Lo demas (un chat nuevo, uno que no se ve, filtros que solo sabe la base) se
 *   junta durante 800 ms y se pregunta POR ID, en un solo pedido chico, con la
 *   misma consulta que la lista (`loadConversationsByIds`). La base dice si entra
 *   y como esta; lo que ya no cumple, sale.
 * - Lo que cae mas abajo de lo cargado no se pregunta: aparece solo al bajar.
 * - Un chat que la lista oculta (nunca escribio) se pregunta una vez por minuto
 *   como mucho: ManyChat le escribe a cada seguidor nuevo y eso era una recarga
 *   de pagina por mensaje.
 * - Si se corto la conexion en vivo (la compu en reposo), al volver se pide la
 *   pagina una vez para no perder nada; lo que ya se habia bajado se conserva
 *   (`mergeFreshFirstChunk`).
 */

/** Cuanto se juntan los cambios antes de preguntarle al servidor. */
export const LIVE_BATCH_MS = 800;
/** Un chat oculto (nunca escribio) se vuelve a preguntar, como mucho, cada tanto. */
const HIDDEN_RECHECK_MS = 60_000;
/** Despues de cuanto tiempo en segundo plano se vuelve a pedir la pagina. */
const STALE_AFTER_HIDDEN_MS = 60_000;

type ConversationsRow = Database["public"]["Tables"]["conversations"]["Row"];

export interface InboxListInitial {
  rows: ConversationRow[];
  cursor: ListCursor | null;
  hasMore: boolean;
  total: number;
  draftConversationIds: string[];
}

export function useInboxList({
  initial,
  listQuery,
  filters,
  dateRange,
  workspaceId,
}: {
  initial: InboxListInitial;
  /** La parte de la URL con los filtros (`listQueryOf`). Cambia = otra lista. */
  listQuery: string;
  filters: InboxFilters;
  dateRange: DateRange;
  workspaceId: string;
}) {
  const router = useRouter();
  const [list, setList] = useState<LoadedList<ConversationRow>>(() => ({
    rows: initial.rows,
    cursor: initial.cursor,
    hasMore: initial.hasMore,
  }));
  const [total, setTotal] = useState(initial.total);
  const [drafts, setDrafts] = useState(() => new Set(initial.draftConversationIds));
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Lo ultimo de todo, para los callbacks del tiempo real sin volver a suscribirse.
  const listRef = useRef(list);
  listRef.current = list;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const rangeRef = useRef(dateRange);
  rangeRef.current = dateRange;
  const queryRef = useRef(listQuery);
  queryRef.current = listQuery;

  // La pagina se volvio a pedir: con los mismos filtros se conserva lo bajado; con otros, se arranca de cero.
  const seededQuery = useRef(listQuery);
  useEffect(() => {
    const fresh = { rows: initial.rows, cursor: initial.cursor, hasMore: initial.hasMore };
    const sameList = seededQuery.current === listQuery;
    seededQuery.current = listQuery;
    setList((prev) => (sameList ? mergeFreshFirstChunk(prev, fresh) : fresh));
    setTotal(initial.total);
    setLoadError(null);
    const freshIds = new Set(initial.rows.map((r) => r.id));
    setDrafts((prev) =>
      sameList
        ? new Set([...[...prev].filter((id) => !freshIds.has(id)), ...initial.draftConversationIds])
        : new Set(initial.draftConversationIds),
    );
  }, [initial, listQuery]);

  /** Lo que se cambia a mano en una fila (marcar conocido, borrar) antes de que confirme el servidor. */
  const setRows = useCallback((update: (rows: ConversationRow[]) => ConversationRow[]) => {
    setList((prev) => ({ ...prev, rows: update(prev.rows) }));
  }, []);

  const loadingRef = useRef(false);
  const loadMore = useCallback(async () => {
    const current = listRef.current;
    if (loadingRef.current || !current.hasMore || !current.cursor) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadError(null);
    const query = queryRef.current;
    try {
      const res = await loadMoreConversations(query, current.cursor);
      // Mientras tanto cambiaron los filtros: esta tanda ya no corresponde.
      if (query !== queryRef.current) return;
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setList((prev) => appendChunk(prev, { rows: res.rows, cursor: res.cursor, hasMore: res.hasMore }));
      if (res.draftConversationIds.length > 0) setDrafts((prev) => new Set([...prev, ...res.draftConversationIds]));
    } catch {
      setLoadError("No pude traer más chats. Revisá la conexión y probá de nuevo.");
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  // ---- Tiempo real ----------------------------------------------------------
  const onlyGroups = filters.listType === "grupos";
  useEffect(() => {
    // Solo grupos: ninguna conversacion entra en la lista.
    if (onlyGroups) return;
    const supabase = createClient();
    const pending = new Set<string>();
    const inserted = new Set<string>();
    const hiddenCheckedAt = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let disposed = false;

    const flush = async () => {
      timer = null;
      if (inFlight || pending.size === 0 || disposed) return;
      inFlight = true;
      const ids = [...pending].slice(0, 50);
      ids.forEach((id) => pending.delete(id));
      const query = queryRef.current;
      try {
        const res = await loadConversationsByIds(query, ids);
        if (disposed || query !== queryRef.current) return;
        if (!res.ok) {
          // No se pudo preguntar por id: la pagina entera, como antes, para no quedar desactualizados.
          router.refresh();
          return;
        }
        const result = applyFetchedRows(listRef.current, res.rows, res.notMatching);
        listRef.current = result.state;
        setList(result.state);
        const delta = result.added.filter((id) => inserted.has(id)).length - result.removed.length;
        if (delta !== 0) setTotal((t) => Math.max(0, t + delta));
        ids.forEach((id) => inserted.delete(id));
        const withDraft = new Set(res.draftConversationIds);
        setDrafts((prev) => {
          const next = new Set([...prev].filter((id) => !ids.includes(id)));
          withDraft.forEach((id) => next.add(id));
          return next;
        });
      } catch {
        router.refresh();
      } finally {
        inFlight = false;
        if (pending.size > 0 && !disposed && !timer) timer = setTimeout(flush, LIVE_BATCH_MS);
      }
    };

    const enqueue = (id: string) => {
      pending.add(id);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, LIVE_BATCH_MS);
    };

    const onChange = (payload: { eventType: string; new: Partial<ConversationsRow>; old: Partial<ConversationsRow> }) => {
      const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Partial<ConversationsRow>;
      if (!row?.id) return;
      const state = listRef.current;
      const current = state.rows.find((c) => c.id === row.id);
      const currentFilters = filtersRef.current;

      if (current && payload.eventType === "UPDATE") {
        const merged = { ...current, ...(row as Partial<ConversationRow>) } as ConversationRow;
        if (matchesInboxRow(merged, currentFilters, rangeRef.current)) {
          // En el acto: es lo que hace que un mensaje nuevo suba la conversacion arriba.
          const rows = mergeVisibleUpdate(state.rows, merged);
          listRef.current = { ...state, rows };
          setList(listRef.current);
          // Lo que solo sabe la base (etiquetas, responsable...) lo confirma el servidor.
          if (needsServerToFilter(currentFilters)) enqueue(row.id);
          return;
        }
        enqueue(row.id);
        return;
      }
      if (current) {
        enqueue(row.id);
        return;
      }

      // No esta a la vista.
      if (payload.eventType === "DELETE") return;
      // Cae mas abajo de lo cargado: aparece solo al bajar, no hace falta preguntar.
      if (
        state.hasMore &&
        state.cursor &&
        row.created_at &&
        isAfterCursor({ id: row.id, last_message_at: row.last_message_at ?? null, created_at: row.created_at }, state.cursor)
      ) {
        return;
      }
      // Nunca escribio: la lista suele ocultarlo (00296). Una pregunta por minuto alcanza.
      if (!currentFilters.onlyUnidentified && !row.contact_wrote_at) {
        const last = hiddenCheckedAt.get(row.id) ?? 0;
        if (Date.now() - last < HIDDEN_RECHECK_MS) return;
        hiddenCheckedAt.set(row.id, Date.now());
      }
      if (payload.eventType === "INSERT") inserted.add(row.id);
      enqueue(row.id);
    };

    let lostConnection = false;
    const channel = supabase
      .channel("conversations-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${workspaceId}` },
        (payload) => onChange(payload as unknown as Parameters<typeof onChange>[0]),
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") lostConnection = true;
        // Volvio despues de un corte: lo que paso mientras tanto no llego. La pagina una vez.
        if (status === "SUBSCRIBED" && lostConnection) {
          lostConnection = false;
          router.refresh();
        }
      });

    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt > STALE_AFTER_HIDDEN_MS) router.refresh();
      hiddenAt = null;
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(channel);
    };
  }, [workspaceId, listQuery, onlyGroups, router]);

  return {
    rows: list.rows,
    hasMore: list.hasMore,
    total,
    drafts,
    setRows,
    loadMore,
    loadingMore,
    loadError,
  };
}
