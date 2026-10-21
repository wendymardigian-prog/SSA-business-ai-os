"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { checkInterestChange, interestLabel } from "@/lib/contacts/interest";
import { loadInterestCatalog } from "@/lib/contacts/interest-load";

/**
 * El producto de interés del contacto (00246), con su variante opcional.
 *
 * Pide `contacts.edit` y escribe con el cliente de la sesión: la RLS de
 * contactos decide si lo puede tocar (un Member, solo lo suyo). El catálogo se
 * lee del workspace de la sesión; un producto o una variante de otro workspace
 * no aparecen, y la base lo vuelve a validar (trigger `contacts_interest_check`).
 * El historial guarda los NOMBRES, no los ids.
 */
export type ContactInterestResult = { ok: true } | { ok: false; error: string };

export async function setContactInterest(
  contactId: string,
  productId: string | null,
  variantId: string | null,
): Promise<ContactInterestResult> {
  const ctx = await getPermissionAction("contacts.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para editar contactos" };
  if (typeof contactId !== "string" || !contactId) return { ok: false, error: "Falta el contacto" };
  const nextProduct = productId || null;
  const nextVariant = nextProduct ? variantId || null : null;

  const { data: contact } = await ctx.supabase
    .from("contacts")
    .select("id, interest_product_id, interest_variant_id")
    .eq("id", contactId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return { ok: false, error: "No encontré ese contacto" };

  const current = { productId: contact.interest_product_id ?? null, variantId: contact.interest_variant_id ?? null };
  if (current.productId === nextProduct && current.variantId === nextVariant) return { ok: true };

  const catalog = await loadInterestCatalog(ctx.supabase, ctx.workspace.id);
  const check = checkInterestChange(catalog, current, { productId: nextProduct, variantId: nextVariant });
  if (!check.ok) return check;

  const { data: updated, error } = await ctx.supabase
    .from("contacts")
    .update({ interest_product_id: nextProduct, interest_variant_id: nextVariant })
    .eq("id", contactId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id");
  if (error || !updated?.length) {
    if (error) console.error("[contact-interest] no pude guardar:", error.message);
    return { ok: false, error: "No pude guardar el producto de interés" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "contact",
    entityId: contactId,
    action: "update",
    changes: {
      interest_product: {
        old: current.productId ? interestLabel(catalog, current.productId, current.variantId) : null,
        new: nextProduct ? interestLabel(catalog, nextProduct, nextVariant) : null,
      },
    },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/contacts");
  revalidatePath(`/dashboard/contacts/${contactId}`);
  return { ok: true };
}
