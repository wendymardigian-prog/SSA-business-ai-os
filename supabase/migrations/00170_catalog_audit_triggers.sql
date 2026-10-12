-- ============================================================
-- 00170_catalog_audit_triggers.sql
--
-- Ventas, Fase 1 · el historial de productos y variantes lo escribe la BASE.
--
-- Por que: hasta ahora cada Server Action de `lib/actions/products.ts` llamaba a
-- `logAudit`. Eso dejaba dos huecos: (1) las policies de la 00159 dejan escribir
-- directo a quien tiene `settings.manage`, sin pasar por la accion, y (2) si
-- `logAudit` fallaba, el cambio ya estaba guardado sin historial. Con un trigger,
-- TODO cambio queda en `audit_log`, venga de la pantalla, del boton de Contenido,
-- del puente de `content_offers` o de una escritura directa. Es el mismo criterio
-- que `create_sale` (00162), que escribe la auditoria dentro de la transaccion.
--
-- Que escribe (entity_type `product` o `product_variant`):
--   alta                       product.created / variant.created
--   cambio de estado           product.status_changed
--   archivar / restaurar       variant.archived / variant.restored
--   cambio de precio           variant.price_changed   (changes.price = {old, new})
--   cualquier otro campo       product.updated / variant.updated  (changes = diff)
--   baja (solo el rollback de una alta que fallo)   product.deleted / variant.deleted
--
-- Un UPDATE que cambia varios campos escribe UNA fila. Un UPDATE que no cambia
-- nada (el `ON CONFLICT DO UPDATE` del puente con los mismos valores) no escribe nada.
-- `updated_at` y `updated_by` no cuentan como cambio.
--
-- Quien lo hizo: `auth.uid()`; si no hay sesion (cliente de servicio), `updated_by`
-- / `created_by`; si tampoco, actor `system`.
--
-- Al mismo tiempo se SACAN las llamadas `audit()` de `lib/actions/products.ts`:
-- un test falla si vuelven (`lib/actions/products-audit.test.ts`), porque
-- duplicarian cada fila.
--
-- No toca `audit_log_select` ni ninguna policy. Aditiva e idempotente.
--
-- ------------------------------------------------------------
-- COMO VOLVER ATRAS:
--   DROP TRIGGER IF EXISTS products_audit ON public.products;
--   DROP TRIGGER IF EXISTS product_variants_audit ON public.product_variants;
--   DROP FUNCTION IF EXISTS public.catalog_audit();
--   (y volver a poner las llamadas `audit()` en lib/actions/products.ts)
-- ============================================================

CREATE OR REPLACE FUNCTION public.catalog_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_product boolean := TG_TABLE_NAME = 'products';
  v_entity text := CASE WHEN TG_TABLE_NAME = 'products' THEN 'product' ELSE 'product_variant' END;
  v_prefix text := CASE WHEN TG_TABLE_NAME = 'products' THEN 'product' ELSE 'variant' END;
  v_actor uuid;
  v_action text;
  v_changes jsonb;
  v_meta jsonb;
  v_row jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Borrar un workspace entero (cascade) se lleva sus productos: el workspace ya no existe
    -- y el historial tampoco tiene a donde escribirse.
    IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN
      RETURN OLD;
    END IF;
    v_actor := COALESCE(auth.uid(), OLD.updated_by, OLD.created_by);
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type, actor_label)
    VALUES (OLD.workspace_id, v_entity, OLD.id, v_prefix || '.deleted', NULL,
            jsonb_build_object('name', OLD.name),
            v_actor,
            CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
            CASE WHEN v_actor IS NULL THEN 'Sistema' END);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_actor := COALESCE(auth.uid(), NEW.created_by);
    -- Por jsonb y no por `NEW.price`: la misma funcion corre sobre dos tablas y cada una tiene sus columnas.
    v_row := to_jsonb(NEW);
    v_meta := CASE WHEN v_is_product
      THEN jsonb_build_object('name', v_row ->> 'name', 'product_type', v_row ->> 'product_type')
      ELSE jsonb_build_object('name', v_row ->> 'name', 'product_id', v_row ->> 'product_id', 'price', v_row -> 'price')
    END;
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type, actor_label)
    VALUES (NEW.workspace_id, v_entity, NEW.id, v_prefix || '.created', NULL, v_meta,
            v_actor,
            CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
            CASE WHEN v_actor IS NULL THEN 'Sistema' END);
    RETURN NEW;
  END IF;

  -- UPDATE: el diff campo por campo, sin `updated_at` ni `updated_by`.
  SELECT jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
    INTO v_changes
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
   WHERE n.value IS DISTINCT FROM o.value
     AND n.key NOT IN ('updated_at', 'updated_by');

  -- No cambio nada: no hay nada que contar.
  IF v_changes IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_is_product THEN
    IF v_changes ? 'status' OR v_changes ? 'archived_at' THEN
      v_action := 'product.status_changed';
      -- `archived_at` acompana siempre al estado (CHECK de la 00159): el cambio que se lee es el del estado.
      IF v_changes ? 'status' THEN v_changes := v_changes - 'archived_at'; END IF;
    ELSE
      v_action := 'product.updated';
    END IF;
  ELSE
    IF v_changes ? 'archived_at' THEN
      v_action := CASE WHEN NEW.archived_at IS NULL THEN 'variant.restored' ELSE 'variant.archived' END;
    ELSIF v_changes ? 'price' THEN
      v_action := 'variant.price_changed';
    ELSE
      v_action := 'variant.updated';
    END IF;
  END IF;

  v_actor := COALESCE(auth.uid(), NEW.updated_by);
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type, actor_label)
  VALUES (NEW.workspace_id, v_entity, NEW.id, v_action, v_changes, NULL,
          v_actor,
          CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
          CASE WHEN v_actor IS NULL THEN 'Sistema' END);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.catalog_audit() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.catalog_audit() IS
  'Escribe el historial (audit_log) de products y product_variants: alta, estado, precio, archivado y el resto de los campos (00170).';

DROP TRIGGER IF EXISTS products_audit ON public.products;
CREATE TRIGGER products_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.catalog_audit();

DROP TRIGGER IF EXISTS product_variants_audit ON public.product_variants;
CREATE TRIGGER product_variants_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.catalog_audit();
