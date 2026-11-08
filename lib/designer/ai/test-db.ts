/**
 * Una base de datos en memoria para los tests de la IA del Diseñador.
 *
 * Entiende lo justo de PostgREST: `select`, `insert`, `update`, `eq`, `is`,
 * `order`, `limit`, `maybeSingle`, `single` y el Storage (`download`,
 * `createSignedUrls`). No valida nada: es un doble, no la base. No lo importa
 * nada fuera de los tests.
 */

type Row = Record<string, unknown>;

export interface MemoryDbOptions {
  /** Archivos del Storage por ruta (se bajan con `download`). */
  files?: Record<string, Uint8Array>;
  /** Se llama antes de cada `update`: sirve para simular a otra persona guardando en el medio. */
  beforeUpdate?: (table: string, rows: Row[]) => void;
  /** Hace fallar las subidas al Storage con este mensaje. */
  uploadError?: string;
}

export function memoryDb(initial: Record<string, Row[]>, options: MemoryDbOptions = {}) {
  const tables: Record<string, Row[]> = initial;
  const inserts: { table: string; row: Row }[] = [];
  const updates: { table: string; patch: Row }[] = [];
  const uploads: { path: string; bytes: Uint8Array; contentType?: string }[] = [];
  const removed: string[] = [];
  const files: Record<string, Uint8Array> = { ...(options.files ?? {}) };
  let counter = 0;

  function query(name: string, mode: "select" | "update", patch?: Row) {
    const filters: { col: string; val: unknown; isNull?: boolean }[] = [];
    let wantsRows = mode === "select";
    const run = () => {
      const rows = (tables[name] ??= []);
      if (mode === "update") options.beforeUpdate?.(name, rows);
      // `is(col, null)` como en Postgres: una columna que la fila no trae vale NULL.
      const matched = rows.filter((r) => filters.every((f) => (f.isNull ? r[f.col] == null : r[f.col] === f.val)));
      if (mode === "update") {
        for (const row of matched) Object.assign(row, patch);
        updates.push({ table: name, patch: patch ?? {} });
      }
      return matched;
    };
    const q = {
      eq(col: string, val: unknown) {
        filters.push({ col, val });
        return q;
      },
      is(col: string, val: unknown) {
        filters.push(val === null ? { col, val, isNull: true } : { col, val });
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      select() {
        wantsRows = true;
        return q;
      },
      async maybeSingle() {
        return { data: run()[0] ?? null, error: null };
      },
      async single() {
        const row = run()[0] ?? null;
        return row ? { data: row, error: null } : { data: null, error: { message: "no hay fila", code: "PGRST116" } };
      },
      then(resolve: (value: unknown) => unknown) {
        const matched = run();
        return Promise.resolve(wantsRows ? { data: matched, error: null } : { data: null, error: null }).then(resolve);
      },
    };
    return q;
  }

  function insertQuery(name: string, input: Row | Row[]) {
    const list = Array.isArray(input) ? input : [input];
    const added: Row[] = list.map((row) => {
      counter++;
      const created: Row = { id: `${name}_${counter}`, created_at: new Date(Date.UTC(2026, 10, 7, 12, 0, counter)).toISOString(), ...row };
      (tables[name] ??= []).push(created);
      inserts.push({ table: name, row: created });
      return created;
    });
    const q = {
      select() {
        return q;
      },
      async single() {
        return { data: added[0], error: null };
      },
      async maybeSingle() {
        return { data: added[0], error: null };
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return q;
  }

  const db = {
    from(name: string) {
      return {
        select: () => query(name, "select"),
        insert: (row: Row | Row[]) => insertQuery(name, row),
        update: (patch: Row) => query(name, "update", patch),
      };
    },
    storage: {
      from: (_bucket: string) => ({
        async download(path: string) {
          const bytes = files[path];
          if (!bytes) return { data: null, error: { message: "no existe" } };
          return { data: new Blob([bytes as BlobPart]), error: null };
        },
        async upload(path: string, bytes: Uint8Array, opts?: { contentType?: string }) {
          if (options.uploadError) return { data: null, error: { message: options.uploadError } };
          files[path] = bytes;
          uploads.push({ path, bytes, contentType: opts?.contentType });
          return { data: { path }, error: null };
        },
        async remove(paths: string[]) {
          for (const path of paths) {
            delete files[path];
            removed.push(path);
          }
          return { data: [], error: null };
        },
        async createSignedUrls(paths: string[]) {
          return { data: paths.map((path) => ({ path, signedUrl: `https://firmado.example/${path}` })), error: null };
        },
      }),
    },
  };
  return { db: db as never, tables, inserts, updates, uploads, removed, files };
}

/** Un PNG mínimo (la firma y relleno): alcanza para `sniffMime`. */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4]);
