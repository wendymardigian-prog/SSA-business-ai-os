/**
 * Un cliente de Supabase en memoria, con lo justo que usan las acciones y el job de render del Diseñador IA
 * (tablas con `select / insert / update / delete`, filtros `eq / in / is`, `maybeSingle / single`, y un Storage
 * con `upload / download / list / remove / createSignedUrl`). Solo para tests: nunca habla con nadie.
 */

export type Row = Record<string, unknown>;

interface Filter {
  op: "eq" | "neq" | "in" | "is";
  column: string;
  value: unknown;
}

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

let counter = 0;

class Query implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private returning = false;
  private mode: "many" | "maybe" | "single" = "many";
  private max: number | null = null;

  constructor(
    private readonly db: MemoryDb,
    private readonly table: string,
  ) {}

  select(_columns?: string): this {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(values: Row | Row[]): this {
    this.op = "insert";
    this.payload = values;
    return this;
  }
  update(values: Row): this {
    this.op = "update";
    this.payload = values;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push({ op: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push({ op: "neq", column, value });
    return this;
  }
  in(column: string, value: unknown[]): this {
    this.filters.push({ op: "in", column, value });
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push({ op: "is", column, value });
    return this;
  }
  order(): this {
    return this;
  }
  limit(n: number): this {
    this.max = n;
    return this;
  }
  maybeSingle(): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
    this.mode = "maybe";
    return this.exec();
  }
  single(): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
    this.mode = "single";
    return this.exec();
  }
  then<T1 = { data: unknown; error: { message: string; code?: string } | null }, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string; code?: string } | null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const v = row[f.column];
      if (f.op === "eq") return v === f.value;
      if (f.op === "neq") return v !== f.value;
      if (f.op === "in") return (f.value as unknown[]).includes(v);
      return f.value === null ? v === null || v === undefined : v === f.value;
    });
  }

  private async exec(): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
    const rows = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    const failure = this.db.failures.get(`${this.table}.${this.op}`);
    if (failure) return { data: null, error: { message: failure } };
    let out: Row[] = [];
    if (this.op === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const item of list) {
        const row = { id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`, ...item };
        rows.push(row);
        out.push(row);
      }
      this.db.log.push({ table: this.table, op: "insert", values: list });
    } else if (this.op === "update") {
      out = rows.filter((r) => this.matches(r));
      for (const row of out) Object.assign(row, this.payload);
      this.db.log.push({ table: this.table, op: "update", values: [this.payload as Row], filters: this.filters });
    } else if (this.op === "delete") {
      out = rows.filter((r) => this.matches(r));
      this.db.tables[this.table] = rows.filter((r) => !out.includes(r));
      this.db.log.push({ table: this.table, op: "delete", values: [], filters: this.filters });
    } else {
      out = rows.filter((r) => this.matches(r));
      if (this.max !== null) out = out.slice(0, this.max);
      const snapshot = out.map((r) => ({ ...r }));
      this.db.onSelect?.(this.table);
      out = snapshot;
    }
    if (this.op !== "select" && !this.returning && this.mode === "many") return { data: null, error: null };
    if (this.mode === "many") return { data: out.map((r) => ({ ...r })), error: null };
    if (out.length === 0) return this.mode === "single" ? { data: null, error: { message: "no rows", code: "PGRST116" } } : { data: null, error: null };
    return { data: { ...out[0] }, error: null };
  }
}

class Bucket {
  constructor(private readonly db: MemoryDb, private readonly name: string) {}
  private get files(): Map<string, StoredObject> {
    let bucket = this.db.buckets.get(this.name);
    if (!bucket) this.db.buckets.set(this.name, (bucket = new Map()));
    return bucket;
  }
  async upload(path: string, bytes: Uint8Array | Blob, opts?: { contentType?: string; upsert?: boolean }) {
    const failure = this.db.failures.get(`storage.upload`);
    if (failure) return { data: null, error: { message: failure } };
    if (!opts?.upsert && this.files.has(path)) return { data: null, error: { message: "The resource already exists" } };
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(await (bytes as Blob).arrayBuffer());
    this.files.set(path, { bytes: data, contentType: opts?.contentType ?? "application/octet-stream" });
    return { data: { path }, error: null };
  }
  async download(path: string) {
    const file = this.files.get(path);
    if (!file) return { data: null, error: { message: "Object not found" } };
    return { data: new Blob([file.bytes as BlobPart], { type: file.contentType }), error: null };
  }
  async list(folder: string, opts?: { limit?: number }) {
    this.db.storageLog.push(`list:${folder}`);
    const prefix = folder.replace(/\/+$/, "") + "/";
    const names = new Set<string>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      names.add(path.slice(prefix.length).split("/")[0]);
    }
    return { data: [...names].slice(0, opts?.limit ?? 100).map((name) => ({ name })), error: null };
  }
  async remove(paths: string[]) {
    const failure = this.db.failures.get("storage.remove");
    if (failure) return { data: null, error: { message: failure } };
    for (const p of paths) this.files.delete(p);
    return { data: paths.map((name) => ({ name })), error: null };
  }
  async createSignedUrl(path: string, seconds: number, opts?: { download?: string | boolean }) {
    if (!this.files.has(path)) return { data: null, error: { message: "Object not found" } };
    const dl = opts?.download ? `&download=${encodeURIComponent(String(opts.download))}` : "";
    return { data: { signedUrl: `https://storage.test/${this.name}/${path}?token=t&ttl=${seconds}${dl}` }, error: null };
  }
  async createSignedUrls(paths: string[], seconds: number) {
    return { data: paths.map((path) => ({ path, signedUrl: `https://storage.test/${this.name}/${path}?ttl=${seconds}` })), error: null };
  }
}

export class MemoryDb {
  tables: Record<string, Row[]> = {};
  buckets = new Map<string, Map<string, StoredObject>>();
  log: { table: string; op: "insert" | "update" | "delete"; values: Row[]; filters?: Filter[] }[] = [];
  /** Se llama después de cada lectura (para simular que algo cambió entre leer y escribir). */
  onSelect?: (table: string) => void;
  /** Lo que se le pidió al Storage (`list:<carpeta>`), para comprobar que NO se lo miró. */
  storageLog: string[] = [];
  /** `"tabla.op"` o `"storage.upload"` → el mensaje del error que tiene que devolver. */
  failures = new Map<string, string>();

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [table, rows] of Object.entries(seed)) this.tables[table] = rows.map((r) => ({ ...r }));
  }

  from(table: string): Query {
    return new Query(this, table);
  }

  readonly storage = { from: (bucket: string) => new Bucket(this, bucket) };

  /** Las funciones de la base (`rpc`) que el test quiere simular: nombre → lo que devuelve. */
  rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {};
  rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<{ data: unknown; error: { message: string } | null }> {
    this.rpcCalls.push({ name, args });
    const failure = this.failures.get(`rpc.${name}`);
    if (failure) return { data: null, error: { message: failure } };
    const handler = this.rpcs[name];
    if (!handler) return { data: null, error: { message: `rpc ${name} no simulada` } };
    return { data: handler(args), error: null };
  }

  /** Las rutas guardadas en un bucket. */
  paths(bucket: string): string[] {
    return [...(this.buckets.get(bucket)?.keys() ?? [])].sort();
  }
  put(bucket: string, path: string, bytes: Uint8Array = new Uint8Array([1]), contentType = "image/png"): void {
    let b = this.buckets.get(bucket);
    if (!b) this.buckets.set(bucket, (b = new Map()));
    b.set(path, { bytes, contentType });
  }
  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }
  /** Para pasarlo donde se espera un `SupabaseClient`. */
  get client(): never {
    return this as never;
  }
}
