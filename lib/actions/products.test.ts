/**
 * Ventas F3 a F6: las acciones del catalogo. Fija que sin `products.manage` no
 * se escribe nada, que nada se borra (salvo la limpieza de un alta que fallo) y que
 * el precio vive en la variante. El historial NO se escribe aca: lo hace la base
 * (00170, `products-audit.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "00000000-0000-4000-8000-000000000001";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let db: MemoryDb;
let role = "admin";
let roleId: string | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: "user-1" }, workspace: { id: WS }, role, roleId, supabase: db.client }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));

const actions = await import("./products");

function memory(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  return memoryDb({ products: [], product_variants: [], workspace_roles: [], ...seed });
}

beforeEach(() => {
  role = "admin";
  roleId = null;
  db = memory();
});

const product = (extra: Record<string, unknown> = {}) => ({
  id: U(10), workspace_id: WS, name: "Mentoría", description: null, product_type: "otro", status: "active", archived_at: null, display_order: 0, ...extra,
});
const variant = (extra: Record<string, unknown> = {}) => ({
  id: U(20), workspace_id: WS, product_id: U(10), name: "Estándar", duration_type: "lifetime", duration_value: null,
  guarantee_duration_type: null, guarantee_duration_value: null, billing_type: "one_time", billing_interval: null, display_order: 0, price: 1497, archived_at: null, ...extra,
});

describe("permiso", () => {
  it("un Member de sistema no escribe nada", async () => {
    role = "member";
    expect((await actions.createProduct({ name: "X" })).ok).toBe(false);
    expect((await actions.setProductStatus({ id: U(10), status: "inactive" })).ok).toBe(false);
    expect((await actions.setVariantPrice({ variantId: U(20), priceUsd: 1 })).ok).toBe(false);
    expect(db.rows("products")).toHaveLength(0);
  });

  it("un rol personalizado con products.manage sí", async () => {
    role = "member";
    roleId = "rol-1";
    db.rows("workspace_roles").push({ id: "rol-1", workspace_id: WS, system_role: null, permissions: { keys: ["products.manage"], scopes: {} } });
    expect((await actions.createProduct({ name: "X" })).ok).toBe(true);
  });
});

describe("createProduct", () => {
  it("crea exactamente un producto y una variante Estándar sin precio", async () => {
    const r = await actions.createProduct({ name: "  Mentoría VIP ", type: "mentoria" });
    expect(r).toMatchObject({ ok: true, data: { name: "Mentoría VIP" } });
    expect(db.rows("products")).toHaveLength(1);
    expect(db.rows("products")[0]).toMatchObject({ workspace_id: WS, product_type: "mentoria", status: "active", created_by: "user-1" });
    expect(db.rows("product_variants")).toHaveLength(1);
    expect(db.rows("product_variants")[0]).toMatchObject({ name: "Estándar", duration_type: "lifetime", billing_type: "one_time", price: 0 });
  });

  it("rechaza un nombre repetido (sin mirar mayúsculas ni espacios)", async () => {
    await actions.createProduct({ name: "Mentoría" });
    const again = await actions.createProduct({ name: " MENTORÍA ", type: "otro" });
    expect(again).toEqual({ ok: false, error: "Ya existe un producto con ese nombre" });
    expect(db.rows("products")).toHaveLength(1);
  });

  it("desde Contenido: el precio va directo a la variante", async () => {
    const r = await actions.createProduct({ name: "Curso", priceUsd: "1500,5", requirePrice: true });
    expect(r.ok).toBe(true);
    expect(db.rows("product_variants")[0]).toMatchObject({ price: 1500.5 });
  });

  it("requirePrice sin precio se rechaza y no deja nada", async () => {
    expect((await actions.createProduct({ name: "Curso", requirePrice: true })).ok).toBe(false);
    expect(db.rows("products")).toHaveLength(0);
  });

  it("un precio negativo o con letras se rechaza y no deja nada", async () => {
    expect((await actions.createProduct({ name: "A", priceUsd: -1 })).ok).toBe(false);
    expect((await actions.createProduct({ name: "B", priceUsd: "abc" })).ok).toBe(false);
    expect(db.rows("products")).toHaveLength(0);
  });

  it("rechaza un tipo inventado y un nombre vacío", async () => {
    expect((await actions.createProduct({ name: "X", type: "inventado" })).ok).toBe(false);
    expect((await actions.createProduct({ name: "  " })).ok).toBe(false);
    expect(db.rows("products")).toHaveLength(0);
  });
});

describe("estado del producto", () => {
  beforeEach(() => {
    db = memory({ products: [product()] });
  });

  it("inactivo y discontinuado archivan; activo desarchiva (se escriben juntos)", async () => {
    expect(await actions.setProductStatus({ id: U(10), status: "inactive" })).toEqual({ ok: true });
    expect(db.rows("products")[0].status).toBe("inactive");
    expect(db.rows("products")[0].archived_at).toBeTruthy();
    const when = db.rows("products")[0].archived_at;
    await actions.setProductStatus({ id: U(10), status: "discontinued" });
    expect(db.rows("products")[0]).toMatchObject({ status: "discontinued", archived_at: when });
    await actions.restoreProduct(U(10));
    expect(db.rows("products")[0]).toMatchObject({ status: "active", archived_at: null });
    expect(db.rows("products")).toHaveLength(1);
  });

  it("archiveProduct es un atajo de 'inactivo'", async () => {
    await actions.archiveProduct(U(10));
    expect(db.rows("products")[0].status).toBe("inactive");
  });

  it("no deja reactivar si ya hay otro activo con el mismo nombre", async () => {
    await actions.setProductStatus({ id: U(10), status: "discontinued" });
    db.rows("products").push(product({ id: U(11) }));
    const r = await actions.setProductStatus({ id: U(10), status: "active" });
    expect(r.ok).toBe(false);
    expect(db.rows("products").find((p) => p.id === U(10))?.status).toBe("discontinued");
  });

  it("un estado inventado o un producto de otro workspace se rechazan", async () => {
    expect((await actions.setProductStatus({ id: U(10), status: "archivado" })).ok).toBe(false);
    db.rows("products").push(product({ id: U(12), workspace_id: "otro", name: "Ajeno" }));
    expect((await actions.setProductStatus({ id: U(12), status: "inactive" })).ok).toBe(false);
  });

  it("editar nombre y tipo no toca el estado", async () => {
    expect(await actions.updateProduct({ id: U(10), name: "Mentoría 2", type: "mentoria" })).toEqual({ ok: true });
    expect(db.rows("products")[0]).toMatchObject({ name: "Mentoría 2", product_type: "mentoria", status: "active" });
  });
});

describe("variantes", () => {
  beforeEach(() => {
    db = memory({ products: [product()], product_variants: [variant()] });
  });

  it("recurring sin intervalo se rechaza; con intervalo crea la variante con su precio", async () => {
    expect((await actions.createVariant({ productId: U(10), name: "Mensual", durationType: "months", durationValue: 6, billingType: "recurring" })).ok).toBe(false);
    const ok = await actions.createVariant({ productId: U(10), name: "Mensual", durationType: "months", durationValue: 6, billingType: "recurring", billingInterval: "monthly", priceUsd: 200 });
    expect(ok.ok).toBe(true);
    expect(db.rows("product_variants")).toHaveLength(2);
    expect(db.rows("product_variants")[1]).toMatchObject({ billing_interval: "monthly", display_order: 1, price: 200 });
  });

  it("archivar y restaurar no borran", async () => {
    await actions.archiveVariant(U(20));
    expect(db.rows("product_variants")[0].archived_at).toBeTruthy();
    await actions.restoreVariant(U(20));
    expect(db.rows("product_variants")[0].archived_at).toBeNull();
    expect(db.rows("product_variants")).toHaveLength(1);
  });

  it("duplicar copia la variante con su precio", async () => {
    const r = await actions.duplicateVariant(U(20));
    expect(r.ok).toBe(true);
    const copy = db.rows("product_variants").find((v) => v.id !== U(20))!;
    expect(copy).toMatchObject({ name: "Estándar (copia)", price: 1497, display_order: 1 });
  });
});

describe("precio", () => {
  beforeEach(() => {
    db = memory({ products: [product()], product_variants: [variant({ price: 1497 })] });
  });

  it("cambiar el precio es inmediato y queda en la variante", async () => {
    expect(await actions.setVariantPrice({ variantId: U(20), priceUsd: "1600,5" })).toEqual({ ok: true });
    expect(db.rows("product_variants")[0]).toMatchObject({ price: 1600.5, updated_by: "user-1" });
  });

  it("el mismo precio no escribe nada", async () => {
    const before = JSON.stringify(db.rows("product_variants"));
    expect(await actions.setVariantPrice({ variantId: U(20), priceUsd: 1497 })).toEqual({ ok: true });
    expect(JSON.stringify(db.rows("product_variants"))).toBe(before);
  });

  it("cero deja la variante sin precio (no se puede vender); negativo, vacío y texto se rechazan", async () => {
    expect(await actions.setVariantPrice({ variantId: U(20), priceUsd: 0 })).toEqual({ ok: true });
    expect(db.rows("product_variants")[0].price).toBe(0);
    for (const bad of [-5, "", "abc"]) expect((await actions.setVariantPrice({ variantId: U(20), priceUsd: bad })).ok).toBe(false);
  });

  it("una variante de otro workspace no se toca", async () => {
    db.rows("product_variants").push(variant({ id: U(21), workspace_id: "otro" }));
    expect((await actions.setVariantPrice({ variantId: U(21), priceUsd: 5 })).ok).toBe(false);
    expect(db.rows("product_variants").find((v) => v.id === U(21))?.price).toBe(1497);
  });
});

describe("nada se borra", () => {
  it("el archivo no exporta ninguna acción de borrar", () => {
    const source = readFileSync("lib/actions/products.ts", "utf8");
    const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.filter((n) => /^delete/i.test(n))).toEqual([]);
  });

  it("la única llamada a delete es la limpieza de un alta que falló a la mitad", () => {
    const source = readFileSync("lib/actions/products.ts", "utf8");
    const deletes = [...source.matchAll(/from\("(\w+)"\)\.delete\(\)/g)].map((m) => m[1]);
    expect(deletes).toEqual(["products"]);
  });
});
