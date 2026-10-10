/**
 * Un Supabase de mentira para los tests de acciones y handlers.
 *
 * Encadenable como el real (`from().select().eq().maybeSingle()`), registra
 * cada operacion y contesta lo que cada test le programa por tabla. No intenta
 * ser una base: no filtra, no guarda. Sirve para dos cosas: darle datos a la
 * logica y comprobar QUE se escribio (o que NO se escribio).
 *
 * Una respuesta programada puede ser un valor fijo o una funcion que mira la
 * operacion (util cuando la misma tabla se lee dos veces con filtros distintos).
 */

export type DbOp = "select" | "insert" | "update" | "delete" | "upsert";

export interface DbCall {
  table: string;
  op: DbOp;
  values?: unknown;
  filters: Array<{ method: string; column: string; value: unknown }>;
  single: boolean;
}

export interface DbResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
}

export type DbHandler = DbResult | ((call: DbCall) => DbResult | undefined);

export interface FakeDb {
  /** Cliente listo para pasar donde se espera un SupabaseClient. */
  client: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  calls: DbCall[];
  rpcCalls: Array<{ name: string; args: unknown }>;
  /** Las escrituras (insert/update/delete/upsert), en orden. */
  writes: () => DbCall[];
  writesTo: (table: string) => DbCall[];
}

export function fakeDb(
  handlers: Record<string, DbHandler> = {},
  rpcs: Record<string, DbResult | ((args: unknown) => DbResult)> = {},
): FakeDb {
  const calls: DbCall[] = [];
  const rpcCalls: FakeDb["rpcCalls"] = [];

  function resolve(call: DbCall): DbResult {
    const key = `${call.table}:${call.op}`;
    const h = handlers[key] ?? handlers[call.table];
    const r = typeof h === "function" ? h(call) : h;
    return r ?? { data: call.op === "select" ? [] : null, error: null };
  }

  function builder(table: string) {
    const call: DbCall = { table, op: "select", filters: [], single: false };
    let registered = false;
    const register = () => {
      if (!registered) {
        calls.push(call);
        registered = true;
      }
    };
    const finish = () => {
      register();
      const res = resolve(call);
      let data = res.data;
      if (call.single) data = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
      return { data: data ?? null, error: res.error ?? null, count: res.count ?? null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (values: unknown) => { call.op = "insert"; call.values = values; return b; },
      update: (values: unknown) => { call.op = "update"; call.values = values; return b; },
      upsert: (values: unknown) => { call.op = "upsert"; call.values = values; return b; },
      delete: () => { call.op = "delete"; return b; },
      single: () => { call.single = true; return Promise.resolve(finish()); },
      maybeSingle: () => { call.single = true; return Promise.resolve(finish()); },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(finish()).then(ok, bad),
    };
    for (const m of ["eq", "neq", "is", "in", "gte", "lte", "gt", "lt", "like", "ilike", "or", "not", "contains", "order", "limit", "range", "match", "filter", "textSearch"]) {
      b[m] = (column: string, value?: unknown) => {
        call.filters.push({ method: m, column, value });
        return b;
      };
    }
    // `.select()` despues de un insert/update NO cambia la operacion.
    b.select = () => b;
    return b;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      const r = rpcs[name];
      const res = typeof r === "function" ? r(args) : (r ?? { data: null, error: null });
      return Promise.resolve({ data: res.data ?? null, error: res.error ?? null });
    },
  };

  const writes = () => calls.filter((c) => c.op !== "select");
  return { client, calls, rpcCalls, writes, writesTo: (t) => writes().filter((c) => c.table === t) };
}
