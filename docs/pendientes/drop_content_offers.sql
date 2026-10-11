-- ============================================================================
-- DROP DIFERIDO de `content_offers` (Ventas, Fase 1 · plano §1b.5)
-- ============================================================================
-- *** NO SE APLICA AUTOMATICAMENTE. NO ES UNA MIGRACION. *** Vive FUERA de `supabase/migrations/` a
-- proposito: ni `supabase db push` ni `build-all-migrations.mjs` lo levantan. Es IRREVERSIBLE.
--
-- Por que existe: la 00160 hizo que `products` absorbiera a `content_offers` (mismos ids) y dejo la tabla
-- vieja SIN USO, con un puente (trigger `content_offers_bridge`) para que el codigo viejo desplegado siga
-- andando hasta el deploy. Este script borra el puente y la tabla.
--
-- Cuando se aplica (los CUATRO pasos, en orden, por una persona):
--   1. El codigo de B1 (el que lee `products` y no `content_offers`) esta DESPLEGADO y comprobado en el
--      servicio de Railway (no solo mergeado): ya no queda ninguna instancia vieja escribiendo en la tabla.
--   2. `grep -rn "content_offers" app lib scripts components` NO encuentra lecturas ni escrituras en el
--      codigo (solo comentarios, el tipo generado y scripts/verify-sales.mjs, que prueba el puente).
--   3. Corrieron las consultas de seguridad de abajo (el propio script las corre y ABORTA si alguna falla).
--   4. Hay un RESPALDO: `docs/ventas/respaldo-content-offers.json` (filas completas de content_offers, de
--      `content_ideas.offer_id` y de `content_posts.offer_id`). Generarlo ANTES de aplicar:
--        select jsonb_pretty(jsonb_build_object(
--          'content_offers', (select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.content_offers o),
--          'ideas_con_oferta', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'offer_id', i.offer_id)), '[]') from public.content_ideas i where i.offer_id is not null),
--          'piezas_con_oferta', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'offer_id', p.offer_id)), '[]') from public.content_posts p where p.offer_id is not null)));
--
-- Como volver atras: NO se puede (la tabla desaparece). Solo desde el respaldo del paso 4:
-- recrear la tabla con la definicion de la 00134 (cabecera de la 00160) y reinsertar las filas.
-- ============================================================================

DO $$
DECLARE
  v_orphans integer;
  v_diverged integer;
  v_refs integer;
BEGIN
  -- (a) Toda oferta tiene su producto con el MISMO id.
  SELECT count(*) INTO v_orphans
    FROM public.content_offers o LEFT JOIN public.products p ON p.id = o.id
   WHERE p.id IS NULL;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'DROP content_offers: % oferta(s) no tienen su producto; NO se borra nada', v_orphans;
  END IF;

  -- (b) Ninguna diverge de su producto (nombre, estado, archivado): lo que el puente copio esta al dia.
  SELECT count(*) INTO v_diverged
    FROM public.content_offers o JOIN public.products p ON p.id = o.id
   WHERE p.status <> o.status OR p.archived_at IS DISTINCT FROM o.archived_at OR p.name <> o.name;
  IF v_diverged > 0 THEN
    RAISE EXCEPTION 'DROP content_offers: % oferta(s) divergen de su producto; NO se borra nada', v_diverged;
  END IF;

  -- (c) Ninguna clave foranea apunta todavia a content_offers (las de ideas y piezas ya apuntan a products).
  SELECT count(*) INTO v_refs
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.confrelid = 'public.content_offers'::regclass;
  IF v_refs > 0 THEN
    RAISE EXCEPTION 'DROP content_offers: % clave(s) foranea(s) todavia apuntan a la tabla; NO se borra nada', v_refs;
  END IF;

  -- (d) Las ideas y piezas con oferta apuntan a un producto que existe.
  IF EXISTS (SELECT 1 FROM public.content_ideas i WHERE i.offer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = i.offer_id))
     OR EXISTS (SELECT 1 FROM public.content_posts q WHERE q.offer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = q.offer_id)) THEN
    RAISE EXCEPTION 'DROP content_offers: hay ideas o piezas con una oferta que no es un producto; NO se borra nada';
  END IF;
END $$;

-- El puente y su funcion.
DROP TRIGGER IF EXISTS content_offers_bridge ON public.content_offers;
DROP FUNCTION IF EXISTS public.content_offers_bridge_to_products();

-- La tabla (sus policies, indices y triggers caen con ella).
DROP TABLE IF EXISTS public.content_offers;

-- Despues de aplicarlo:
--   - Registrarlo en `supabase_migrations.schema_migrations` con el siguiente numero libre (00169 o mas).
--   - Quitar el tipo `content_offers` de `lib/types/database.ts` y el caso del puente de `scripts/verify-sales.mjs`
--     (y el de `lib/sales/catalog/no-content-offers.test.ts` que lo exime).
--   - `node scripts/build-all-migrations.mjs`.
