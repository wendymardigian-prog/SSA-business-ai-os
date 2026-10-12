/**
 * La 00169 reescribe `create_sale` y el puente `content_offers_bridge_to_products` partiendo de
 * la definición que había en la base (guardada, letra por letra, en la cabecera de la propia
 * migración). Este test compara las dos versiones y falla si cambió algo más que lo de la
 * variante y el precio: nada de lo demás (atribución, pagos, eventos, auditoría) se tocó.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/00169_variant_price_drop_versions.sql", "utf8");
const header = sql.slice(0, sql.indexOf("-- 1. El precio en la variante"));
const body = sql.slice(sql.indexOf("-- 1. El precio en la variante"));

/** Las líneas de una definición, sin espacios de más y sin líneas vacías. */
const lines = (text: string) => text.split("\n").map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean);

/** El bloque comentado de la cabecera ("-- create_sale (antes):" …) como código. */
function before(title: string): string[] {
  const start = header.indexOf(`-- ${title} (antes):`);
  expect(start).toBeGreaterThan(-1);
  const rest = header.slice(start).split("\n").slice(1);
  const out: string[] = [];
  for (const raw of rest) {
    if (!raw.startsWith("--   ") && raw.trim() !== "--") break;
    out.push(raw.trim() === "--" ? "" : raw.replace(/^--   ?/, ""));
  }
  return lines(out.join("\n"));
}

/** Una función de la migración: desde su CREATE OR REPLACE hasta el cierre del cuerpo. */
function after(name: string): string[] {
  const start = body.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf("$function$\n;", body.indexOf("AS $function$", start));
  return lines(body.slice(start, end + "$function$\n;".length));
}

/** Líneas que están de un lado y no del otro (como multiconjunto). */
function diff(a: string[], b: string[]) {
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const ca = count(a);
  const cb = count(b);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [l, n] of ca) for (let i = 0; i < n - (cb.get(l) ?? 0); i++) removed.push(l);
  for (const [l, n] of cb) for (let i = 0; i < n - (ca.get(l) ?? 0); i++) added.push(l);
  return { removed, added };
}

describe("create_sale (00169): solo cambia lo de la variante", () => {
  const { removed, added } = diff(before("create_sale"), after("create_sale"));

  it("lo que sale es solo la versión del catálogo", () => {
    expect(removed.sort()).toEqual(
      [
        "v_version_id uuid := (p_payload ->> 'product_version_id')::uuid;",
        "v_version public.product_versions%ROWTYPE;",
        "IF v_ws IS NULL OR v_contact IS NULL OR v_version_id IS NULL OR v_base IS NULL OR v_financing IS NULL THEN",
        "-- La version sigue activa y con el mismo precio que se mostro (si no: version_changed + precio nuevo).",
        "SELECT * INTO v_version FROM public.product_versions WHERE id = v_version_id AND workspace_id = v_ws;",
        "IF NOT FOUND THEN RAISE EXCEPTION 'invalid_version'; END IF;",
        "IF v_version.status <> 'active' OR v_version.price IS DISTINCT FROM (p_payload -> 'product_snapshot' ->> 'price')::numeric THEN",
        "RAISE EXCEPTION 'version_changed:%', COALESCE((",
        "SELECT a.price FROM public.product_versions a",
        "WHERE a.product_variant_id = v_version.product_variant_id AND a.status = 'active'), 0);",
        "workspace_id, contact_id, product_version_id, product_snapshot, base_amount, discount_amount, final_amount,",
        "v_ws, v_contact, v_version_id, p_payload -> 'product_snapshot', v_base, v_discount, v_final,",
      ].sort(),
    );
  });

  it("lo que entra es solo la variante y el precio", () => {
    for (const line of added) expect(line).toMatch(/variant|price|invalid_variant|pr\.|products pr|archived_at|THEN|END IF|\) THEN|La variante/i);
    expect(added).toContain("RAISE EXCEPTION 'price_changed:%', v_variant.price;");
    expect(added).toContain("workspace_id, contact_id, product_variant_id, product_snapshot, base_amount, discount_amount, final_amount,");
    expect(added.some((l) => /product_version/.test(l))).toBe(false);
  });

  it("todo lo demás queda igual (la atribución, los pagos, los eventos y la auditoría)", () => {
    const unchanged = diff(before("create_sale"), after("create_sale"));
    const total = before("create_sale").length;
    expect(total - unchanged.removed.length).toBeGreaterThan(110);
    const text = after("create_sale").join("\n");
    for (const needle of ["emit_sales_event(v_ws, 'sale_created'", "'sale.created'", "'payment.paid'", "sale_attribution_from_touch", "plan_unbalanced", "ssa.suppress_sale_refresh"]) {
      expect(text).toContain(needle);
    }
  });
});

describe("el puente de content_offers (00169): solo cambia el precio", () => {
  const { removed, added } = diff(before("content_offers_bridge_to_products"), after("content_offers_bridge_to_products"));

  it("ya no crea ni publica versiones", () => {
    expect(after("content_offers_bridge_to_products").join("\n")).not.toMatch(/product_versions|publish_product_version/);
    expect(removed.some((l) => /product_versions/.test(l))).toBe(true);
  });

  it("copia el precio a la variante y no toca el producto ni la variante por defecto", () => {
    const text = after("content_offers_bridge_to_products").join("\n");
    expect(added.join("\n")).toMatch(/UPDATE public\.product_variants/);
    expect(text).toContain("INSERT INTO public.products (id, workspace_id, name, product_type, status, archived_at, created_by, created_at)");
    expect(text).toContain("INSERT INTO public.product_variants (workspace_id, product_id, name, duration_type, billing_type, display_order, created_by)");
  });
});
