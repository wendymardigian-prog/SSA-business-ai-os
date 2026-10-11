/**
 * Ventas F3 a F6: las acciones del catalogo. Fija que sin `settings.manage` no
 * se escribe nada, que nada se borra (salvo un borrador de version), que una
 * version publicada no se edita y que publicar pasa por la funcion SQL.
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
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined), diffFields: () => null }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: "user-1" }, workspace: { id: WS }, role, roleId, supabase: db.client }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));

const actions = await import("./products");

function memory(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  return memoryDb(
    { products: [], product_variants: [], product_versions: [], workspace_roles: [], ...seed },
    {
      rpc: {
        // Espejo en memoria de publish_product_version (00159): la activa pasa a deprecated, la nueva a active.
        publish_product_version: (args, d) => {
          const versions = d.rows("product_versions");
          const target = versions.find((v) => v.id === args.p_version_id)!;
          const prev = versions.find((v) => v.product_variant_id === target.product_variant_id && v.status === "active");
          if (prev) prev.status = "deprecated";
          target.status = "active";
          return { version_id: target.id, deprecated_version_id: prev?.id ?? null };
        },
      },
    },
  );
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
  guarantee_duration_type: null, guarantee_duration_value: null, billing_type: "one_time", billing_interval: null, display_order: 0, archived_at: null, ...extra,
});
const version = (extra: Record<string, unknown> = {}) => ({
  id: U(30), workspace_id: WS, product_variant_id: U(20), version_number: 1, price: 1497, change_notes: null, status: "draft", ...extra,
});

describe("permiso", () => {
  it("un Member de sistema no escribe nada", async () => {
    role = "member";
    expect((await actions.createProduct({ name: "X" })).ok).toBe(false);
    expect((await actions.setProductStatus({ id: U(10), status: "inactive" })).ok).toBe(false);
    expect((await actions.publishVersion(U(30))).ok).toBe(false);
    expect(db.rows("products")).toHaveLength(0);
  });

  it("un rol personalizado con settings.manage sí", async () => {
    role = "member";
    roleId = "rol-1";
    db.rows("workspace_roles").push({ id: "rol-1", workspace_id: WS, system_role: null, permissions: { keys: ["settings.manage"], scopes: {} } });
    expect((await actions.createProduct({ name: "X" })).ok).toBe(true);
  });
});

describe("createProduct", () => {
  it("crea exactamente un producto, una variante Estándar y una versión en borrador", async () => {
    const r = await actions.createProduct({ name: "  Mentoría VIP ", type: "mentoria" });
    expect(r).toMatchObject({ ok: true, data: { name: "Mentoría VIP" } });
    expect(db.rows("products")).toHaveLength(1);
    expect(db.rows("products")[0]).toMatchObject({ workspace_id: WS, product_type: "mentoria", status: "active", created_by: "user-1" });
    expect(db.rows("product_variants")).toHaveLength(1);
    expect(db.rows("product_variants")[0]).toMatchObject({ name: "Estándar", duration_type: "lifetime", billing_type: "one_time" });
    expect(db.rows("product_versions")).toHaveLength(1);
    expect(db.rows("product_versions")[0]).toMatchObject({ status: "draft", version_number: 1, price: 0, change_notes: "Precio por definir" });
  });

  it("rechaza un nombre repetido (sin mirar mayúsculas ni espacios)", async () => {
    await actions.createProduct({ name: "Mentoría" });
    const again = await actions.createProduct({ name: " MENTORÍA ", type: "otro" });
    expect(again).toEqual({ ok: false, error: "Ya existe un producto con ese nombre" });
    expect(db.rows("products")).toHaveLength(1);
  });

  it("desde Contenido: con precio y publish deja la versión 1 ACTIVA", async () => {
    const r = await actions.createProduct({ name: "Curso", priceUsd: "1500,5", publish: true });
    expect(r.ok).toBe(true);
    expect(db.rows("product_versions")[0]).toMatchObject({ status: "active", price: 1500.5 });
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["publish_product_version"]);
  });

  it("publish sin precio se rechaza y no deja nada", async () => {
    expect((await actions.createProduct({ name: "Curso", publish: true })).ok).toBe(false);
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
    db = memory({ products: [product()], product_variants: [variant()], product_versions: [version({ status: "active" })] });
  });

  it("recurring sin intervalo se rechaza; con intervalo crea variante + versión borrador", async () => {
    expect((await actions.createVariant({ productId: U(10), name: "Mensual", durationType: "months", durationValue: 6, billingType: "recurring" })).ok).toBe(false);
    const ok = await actions.createVariant({ productId: U(10), name: "Mensual", durationType: "months", durationValue: 6, billingType: "recurring", billingInterval: "monthly", priceUsd: 200 });
    expect(ok.ok).toBe(true);
    expect(db.rows("product_variants")).toHaveLength(2);
    expect(db.rows("product_variants")[1]).toMatchObject({ billing_interval: "monthly", display_order: 1 });
    expect(db.rows("product_versions").filter((v) => v.status === "draft")).toHaveLength(1);
  });

  it("archivar y restaurar no borran", async () => {
    await actions.archiveVariant(U(20));
    expect(db.rows("product_variants")[0].archived_at).toBeTruthy();
    await actions.restoreVariant(U(20));
    expect(db.rows("product_variants")[0].archived_at).toBeNull();
    expect(db.rows("product_variants")).toHaveLength(1);
  });

  it("duplicar copia la activa como borrador de la nueva", async () => {
    const r = await actions.duplicateVariant(U(20));
    expect(r.ok).toBe(true);
    const copy = db.rows("product_variants").find((v) => v.id !== U(20))!;
    expect(copy.name).toBe("Estándar (copia)");
    const draft = db.rows("product_versions").find((v) => v.product_variant_id === copy.id)!;
    expect(draft).toMatchObject({ status: "draft", price: 1497, version_number: 1 });
  });
});

describe("versiones", () => {
  beforeEach(() => {
    db = memory({
      products: [product()],
      product_variants: [variant()],
      product_versions: [version({ id: U(30), status: "active", version_number: 1, price: 1497 }), version({ id: U(31), status: "draft", version_number: 2, price: 1600 })],
    });
  });

  it("publicar pasa por la función SQL y deja una sola activa", async () => {
    expect(await actions.publishVersion(U(31))).toEqual({ ok: true });
    expect(db.rpcCalls).toEqual([{ name: "publish_product_version", args: { p_version_id: U(31), p_actor_id: "user-1" } }]);
    const states = Object.fromEntries(db.rows("product_versions").map((v) => [v.id, v.status]));
    expect(states).toEqual({ [U(30)]: "deprecated", [U(31)]: "active" });
  });

  it("no se publica una versión que ya no es borrador", async () => {
    expect((await actions.publishVersion(U(30))).ok).toBe(false);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("un borrador de 'precio por definir' no se publica", async () => {
    db.rows("product_versions").push(version({ id: U(32), version_number: 3, price: 0, change_notes: "Precio por definir" }));
    expect(await actions.publishVersion(U(32))).toEqual({ ok: false, error: "Cargá el precio antes de publicar" });
  });

  it("una publicada no se edita: 'creá una nueva'", async () => {
    const r = await actions.updateVersionDraft({ id: U(30), priceUsd: 1 });
    expect(r).toEqual({ ok: false, error: "Una versión publicada no se edita: creá una nueva" });
    expect(db.rows("product_versions").find((v) => v.id === U(30))?.price).toBe(1497);
  });

  it("un borrador sí se edita y se borra; una publicada no se borra", async () => {
    expect(await actions.updateVersionDraft({ id: U(31), priceUsd: "1700", changeNotes: "Sube" })).toEqual({ ok: true });
    expect(db.rows("product_versions").find((v) => v.id === U(31))).toMatchObject({ price: 1700, change_notes: "Sube" });
    expect((await actions.deleteVersionDraft(U(30))).ok).toBe(false);
    expect(await actions.deleteVersionDraft(U(31))).toEqual({ ok: true });
    expect(db.rows("product_versions")).toHaveLength(1);
  });

  it("crear un borrador toma el número siguiente y exige notas si el precio es 0", async () => {
    const r = await actions.createVersionDraft({ variantId: U(20), priceUsd: 1800, changeNotes: "Nuevo precio" });
    expect(r).toMatchObject({ ok: true, data: { versionNumber: 3 } });
    expect((await actions.createVersionDraft({ variantId: U(20), priceUsd: 0 })).ok).toBe(false);
  });

  it("setVariantPrice crea un borrador y lo publica (Contenido)", async () => {
    expect(await actions.setVariantPrice({ variantId: U(20), priceUsd: 2000 })).toEqual({ ok: true });
    const active = db.rows("product_versions").filter((v) => v.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].price).toBe(2000);
  });
});

describe("nada se borra", () => {
  it("el archivo no exporta ninguna acción de borrar producto ni variante", () => {
    const source = readFileSync("lib/actions/products.ts", "utf8");
    const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.filter((n) => /^delete/i.test(n))).toEqual(["deleteVersionDraft"]);
  });

  it("las únicas llamadas a delete son el borrador de versión y la limpieza de un alta que falló", () => {
    const source = readFileSync("lib/actions/products.ts", "utf8");
    const deletes = [...source.matchAll(/from\("(\w+)"\)\.delete\(\)/g)].map((m) => m[1]).sort();
    expect(deletes).toEqual(["product_variants", "product_variants", "product_variants", "product_versions", "product_versions", "products"]);
  });
});
