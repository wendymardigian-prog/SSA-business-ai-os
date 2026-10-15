/**
 * Ventas F22: la Server Action `createSale`. Fija que sin `sales.manage` no toca la base, que
 * RELEE el catálogo (price_changed), que pasa por la RPC con el cliente de servicio y que el
 * alta del contacto usa find_contact_by_phone_or_email (nunca find_or_link_contact).
 */
import { paymentMethodsFixture } from "@/lib/sales/test-support/payment-methods";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { memoryCentralRpc } from "@/lib/contacts/testing/memory-central";

const WS = "ws-1";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1);
const CONTACT = U(10);
const PRODUCT = U(20);
const VARIANT = U(21);

let db: MemoryDb;
let role = "admin";
let roleId: string | null = null;
let rpcResult: { data?: unknown; error?: { message: string } } = { data: { sale_id: "sale-1" } };
let centralResult: { data?: unknown; error?: { message: string } } = { data: null };
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => null) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: ME },
    workspace: { id: WS, timezone: "America/Costa_Rica", payment_methods: paymentMethodsFixture(["wise", "binance"]), max_discount_percent: null },
    role, roleId, supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: (t: string) => (db.client as unknown as { from: (t: string) => unknown }).from(t),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "find_or_create_contact") {
        // La regla unica: o devuelve lo programado, o crea el contacto en memoria como lo haria la base.
        if (centralResult.error) return { data: null, error: centralResult.error };
        return { data: centralResult.data ?? memoryCentralRpc(args, db), error: null };
      }
      return { data: rpcResult.data ?? null, error: rpcResult.error ?? null };
    },
  }),
}));

const { createSale, createContactForSale } = await import("./sales");

const seed = () =>
  memoryDb({
    contacts: [{ id: CONTACT, workspace_id: WS, deleted_at: null }],
    workspace_members: [{ workspace_id: WS, user_id: ME }],
    products: [{ id: PRODUCT, workspace_id: WS, name: "Mentoría", product_type: "mentoria", status: "active" }],
    product_variants: [{ id: VARIANT, workspace_id: WS, product_id: PRODUCT, name: "Estándar", duration_type: "lifetime", duration_value: null, guarantee_duration_type: null, guarantee_duration_value: null, billing_type: "one_time", billing_interval: null, price: 1297, archived_at: null }],
    workspace_roles: [],
  });

const valid = (over: Record<string, unknown> = {}) => ({
  contactId: CONTACT, variantId: VARIANT, shownPrice: 1297, financing: "full", saleDate: "2026-10-01", setterId: ME,
  payments: [{ type: "full", amount: 1297, status: "scheduled", date: "2026-11-01" }], ...over,
});

beforeEach(() => {
  role = "admin";
  roleId = null;
  rpcResult = { data: { sale_id: "sale-1" } };
  centralResult = { data: null };
  rpcCalls.length = 0;
  db = seed();
});

describe("createSale", () => {
  it("sin sales.manage responde 'sin permiso' y no toca la base", async () => {
    role = "member";
    roleId = "rol-1";
    db.rows("workspace_roles").push({ id: "rol-1", workspace_id: WS, system_role: null, permissions: { keys: ["sales.view"], scopes: {} } });
    const r = await createSale(valid() as never);
    expect(r).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
  });

  it("crea la venta por la RPC create_sale, con el snapshot releído del catálogo", async () => {
    const r = await createSale(valid() as never);
    expect(r).toEqual({ ok: true, id: "sale-1" });
    const call = rpcCalls.find((c) => c.name === "create_sale")!;
    const payload = call.args.p_payload as Record<string, unknown>;
    expect(call.args.p_actor_id).toBe(ME);
    expect(payload).toMatchObject({ workspace_id: WS, contact_id: CONTACT, product_variant_id: VARIANT, base_amount: 1297, discount_amount: 0 });
    expect(payload.product_snapshot).toMatchObject({ product_name: "Mentoría", variant_name: "Estándar", price: 1297, variant_id: VARIANT });
  });

  it("si el precio ya no es el que mostró el asistente: price_changed con el precio nuevo, sin crear nada", async () => {
    db.rows("product_variants")[0].price = 1400;
    const r = await createSale(valid() as never);
    expect(r).toMatchObject({ ok: false, code: "price_changed", newPrice: 1400 });
    expect(rpcCalls).toHaveLength(0);
  });

  it("una variante sin precio (0) no se vende", async () => {
    db.rows("product_variants")[0].price = 0;
    expect(await createSale(valid({ shownPrice: 0 }) as never)).toMatchObject({ ok: false, code: "invalid" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("el cuadre se rechaza en el servidor con la diferencia", async () => {
    const r = await createSale(valid({ payments: [{ type: "full", amount: 1000, status: "scheduled", date: "2026-11-01" }] }) as never);
    expect(r).toMatchObject({ ok: false, code: "plan_unbalanced", diffCents: 29700 });
    expect(rpcCalls).toHaveLength(0);
  });

  it("un producto inactivo o una variante archivada ya no se venden", async () => {
    db.rows("products")[0].status = "inactive";
    expect(await createSale(valid() as never)).toMatchObject({ ok: false });
    db.rows("products")[0].status = "active";
    db.rows("product_variants")[0].archived_at = "2026-10-01T00:00:00Z";
    expect(await createSale(valid() as never)).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
  });

  it("un contacto que no ve o que no existe se rechaza; con contactId NO se llama a find_contact_by_phone_or_email", async () => {
    expect(await createSale(valid({ contactId: U(99) }) as never)).toMatchObject({ ok: false, code: "invalid_contact" });
    await createSale(valid() as never);
    expect(rpcCalls.map((c) => c.name)).not.toContain("find_contact_by_phone_or_email");
  });

  it("los errores de create_sale se traducen (price_changed de la base)", async () => {
    rpcResult = { error: { message: "price_changed:1500" } };
    expect(await createSale(valid() as never)).toMatchObject({ ok: false, code: "price_changed", newPrice: 1500 });
    rpcResult = { error: { message: "invalid_touch" } };
    expect(await createSale(valid() as never)).toMatchObject({ ok: false, code: "invalid_touch" });
  });

  it("con alcance own, quien carga tiene que quedar como setter o vendedor", async () => {
    role = "member";
    roleId = null;
    const r = await createSale(valid({ setterId: null, vendedorId: null }) as never);
    expect(r).toMatchObject({ ok: false, code: "scope" });
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("createContactForSale", () => {
  it("si la regla unica encuentra un contacto, usa ese y NO inserta uno duplicado (y avisa del conflicto)", async () => {
    centralResult = { data: { contact_id: CONTACT, created: false, matched_by: "phone", conflict_contact_id: U(11), conflicts: [{ by: "email", contact_id: U(11) }], status: "found" } };
    const r = await createContactForSale({ name: "Ana", email: "ana@x.co", phone: "+50688887777" });
    expect(r).toMatchObject({ ok: true, contactId: CONTACT, created: false });
    expect(r.ok && r.notice).toContain("El email pertenece a otro contacto");
    expect(db.rows("contacts")).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ name: "find_or_create_contact" });
    expect(rpcCalls.map((c) => c.name)).not.toContain("find_or_link_contact");
  });

  it("si no hay nadie, crea exactamente un contacto nuevo (con el telefono normalizado)", async () => {
    const r = await createContactForSale({ name: "Beto", email: "BETO@x.co", phone: " 506 8888-7777 " });
    expect(r).toMatchObject({ ok: true, created: true });
    expect(db.rows("contacts")).toHaveLength(2);
    expect(db.rows("contacts")[1]).toMatchObject({ workspace_id: WS, display_name: "Beto", email: "beto@x.co", phone: "+50688887777" });
  });

  it("un error de la base al buscar NO se toma como 'no esta': no crea nada", async () => {
    centralResult = { error: { message: "la base se cayo" } };
    const r = await createContactForSale({ name: "Ana", email: "ana@x.co" });
    expect(r).toMatchObject({ ok: false });
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("un telefono que no es un numero y sin email: se rechaza con un mensaje claro", async () => {
    const r = await createContactForSale({ name: "Ana", phone: "123" });
    expect(r).toMatchObject({ ok: false });
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("un Member con alcance own queda como setter del contacto nuevo (si no, no lo vería)", async () => {
    role = "member";
    await createContactForSale({ name: "Carla", phone: "+50611112222" });
    expect(db.rows("contacts")[1].setter_id).toBe(ME);
  });

  it("sin email ni teléfono se rechaza", async () => {
    expect(await createContactForSale({ name: "Dani" })).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
  });
});
