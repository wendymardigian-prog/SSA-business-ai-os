-- ============================================================================
-- 00211 — Equipo y roles (B1, F4): se retira `settings.manage`
-- ============================================================================
-- `settings.manage` mezclaba cuatro cosas distintas (productos, reglas de asignacion, ajustes de
-- ventas y cobranza, y el resto de la configuracion). Se reemplaza por claves con nombre propio:
--
--   products.manage    el catalogo de productos y variantes     (RLS de products / product_variants)
--   assignment.manage  las reglas de asignacion automatica       (RLS de assignment_rules)
--   sales.settings     metodos de pago, descuento, mora, cobranza (solo codigo)
--   settings.general   el resto: pilares de contenido, vincular toques con anuncios, ... (RLS de content_pillars)
--
-- Esta migracion hace DOS cosas:
--
-- 1. Reescribe las 8 politicas que usaban `has_permission(workspace_id, 'settings.manage')`
--    (INSERT y UPDATE de products, product_variants, assignment_rules y content_pillars) con la
--    clave nueva que corresponde. Para Owner y Admin da lo mismo; un rol personalizado que tenia
--    `settings.manage` sigue pudiendo, porque el paso 2 le da las sucesoras.
--
-- 2. Migra el jsonb de los roles PERSONALIZADOS. Quien tenia `settings.manage` recibe TODAS sus
--    sucesoras y pierde la vieja. Y, ya que varias claves se parten en dos, quien tenia la vieja
--    recibe tambien la nueva para no perder nada sin enterarse (decision del 13/10/2026):
--
--      settings.manage      -> settings.general, sales.settings, products.manage, assignment.manage
--      flows.edit           -> + flows.publish, + webhooks.manage
--      team.manage          -> + team.view, + team.invite
--      roles.manage         -> + roles.view
--      integrations.manage  -> + integrations.view, + channels.manage
--      agents.edit          -> + ai_tasks.manage, + ai_limits.manage
--      contacts.edit        -> + contacts.assign        (hoy cualquier miembro reasigna)
--
--    Los roles de sistema NO se tocan (sus permisos vienen de lib/auth/permissions.ts).
--
-- Idempotente: el UPDATE solo agrega lo que falta y quita lo que sobra; correrlo dos veces no cambia nada.
--
-- Control despues de aplicarla:
--   select count(*) from pg_policies where schemaname='public' and (qual ilike '%settings.manage%' or with_check ilike '%settings.manage%');  -- 0
--   select count(*) from workspace_roles where permissions->'keys' ? 'settings.manage';                                                  -- 0
--
-- ----------------------------------------------------------------------------
-- COMO VOLVER ATRAS
-- ----------------------------------------------------------------------------
-- (a) Politicas: volver a ejecutar, sin el prefijo "--   ", estas definiciones (leidas de la base viva ANTES de esta migracion):
--
--   DROP POLICY IF EXISTS assignment_rules_insert ON public.assignment_rules;
--   CREATE POLICY assignment_rules_insert ON public.assignment_rules AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (has_permission(workspace_id, 'settings.manage'::text));
--
--   DROP POLICY IF EXISTS assignment_rules_update ON public.assignment_rules;
--   CREATE POLICY assignment_rules_update ON public.assignment_rules AS PERMISSIVE FOR UPDATE TO public
--     USING (has_permission(workspace_id, 'settings.manage'::text))
--     WITH CHECK (has_permission(workspace_id, 'settings.manage'::text));
--
--   DROP POLICY IF EXISTS content_pillars_insert ON public.content_pillars;
--   CREATE POLICY content_pillars_insert ON public.content_pillars AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (has_permission(workspace_id, 'settings.manage'::text));
--
--   DROP POLICY IF EXISTS content_pillars_update ON public.content_pillars;
--   CREATE POLICY content_pillars_update ON public.content_pillars AS PERMISSIVE FOR UPDATE TO public
--     USING (has_permission(workspace_id, 'settings.manage'::text))
--     WITH CHECK (has_permission(workspace_id, 'settings.manage'::text));
--
--   DROP POLICY IF EXISTS product_variants_insert ON public.product_variants;
--   CREATE POLICY product_variants_insert ON public.product_variants AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (has_permission(workspace_id, 'settings.manage'::text));
--
--   DROP POLICY IF EXISTS product_variants_update ON public.product_variants;
--   CREATE POLICY product_variants_update ON public.product_variants AS PERMISSIVE FOR UPDATE TO public
--     USING (has_permission(workspace_id, 'settings.manage'::text))
--     WITH CHECK (has_permission(workspace_id, 'settings.manage'::text));
--
--   DROP POLICY IF EXISTS products_insert ON public.products;
--   CREATE POLICY products_insert ON public.products AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (has_permission(workspace_id, 'settings.manage'::text));
--
--   DROP POLICY IF EXISTS products_update ON public.products;
--   CREATE POLICY products_update ON public.products AS PERMISSIVE FOR UPDATE TO public
--     USING (has_permission(workspace_id, 'settings.manage'::text))
--     WITH CHECK (has_permission(workspace_id, 'settings.manage'::text));
--
-- (b) El jsonb de los roles personalizados, tal como estaba ANTES (id | nombre | claves):
--   7a187bff-a102-476c-818d-f4008d0b3110 | Content Manager | ["dashboards.chat.view", "dashboards.content.view", "social.view", "inbox.instagram.view", "inbox.instagram.reply", "inbox.whatsapp.view", "inbox.whatsapp.reply", "inbox.email.view", "inbox.email.reply", "contacts.view", "contacts.edit", "flows.view", "flows.edit", "agents.view", "ai_costs.view", "knowledge.view", "content.view", "content.create", "content.approve", "content.publish", "content.ai"]
-- Para restaurar un rol: UPDATE public.workspace_roles SET permissions = jsonb_set(permissions, '{keys}', '<claves de arriba>'::jsonb) WHERE id = '<id>';
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Las 8 politicas, con la clave nueva (mismas condiciones, mismos roles: TO public)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS products_insert ON public.products;
CREATE POLICY products_insert ON public.products FOR INSERT
  WITH CHECK (public.has_permission(workspace_id, 'products.manage'));
DROP POLICY IF EXISTS products_update ON public.products;
CREATE POLICY products_update ON public.products FOR UPDATE
  USING (public.has_permission(workspace_id, 'products.manage'))
  WITH CHECK (public.has_permission(workspace_id, 'products.manage'));

DROP POLICY IF EXISTS product_variants_insert ON public.product_variants;
CREATE POLICY product_variants_insert ON public.product_variants FOR INSERT
  WITH CHECK (public.has_permission(workspace_id, 'products.manage'));
DROP POLICY IF EXISTS product_variants_update ON public.product_variants;
CREATE POLICY product_variants_update ON public.product_variants FOR UPDATE
  USING (public.has_permission(workspace_id, 'products.manage'))
  WITH CHECK (public.has_permission(workspace_id, 'products.manage'));

DROP POLICY IF EXISTS assignment_rules_insert ON public.assignment_rules;
CREATE POLICY assignment_rules_insert ON public.assignment_rules FOR INSERT
  WITH CHECK (public.has_permission(workspace_id, 'assignment.manage'));
DROP POLICY IF EXISTS assignment_rules_update ON public.assignment_rules;
CREATE POLICY assignment_rules_update ON public.assignment_rules FOR UPDATE
  USING (public.has_permission(workspace_id, 'assignment.manage'))
  WITH CHECK (public.has_permission(workspace_id, 'assignment.manage'));

DROP POLICY IF EXISTS content_pillars_insert ON public.content_pillars;
CREATE POLICY content_pillars_insert ON public.content_pillars FOR INSERT
  WITH CHECK (public.has_permission(workspace_id, 'settings.general'));
DROP POLICY IF EXISTS content_pillars_update ON public.content_pillars;
CREATE POLICY content_pillars_update ON public.content_pillars FOR UPDATE
  USING (public.has_permission(workspace_id, 'settings.general'))
  WITH CHECK (public.has_permission(workspace_id, 'settings.general'));

-- ----------------------------------------------------------------------------
-- 2. El jsonb de los roles personalizados
-- ----------------------------------------------------------------------------
-- Para cada clave vieja que tiene el rol, se suman sus sucesoras; `settings.manage` se quita.
-- Solo roles personalizados (`system_role IS NULL`). Idempotente.

UPDATE public.workspace_roles r
SET permissions = jsonb_set(
  r.permissions,
  '{keys}',
  to_jsonb(ARRAY(
    SELECT DISTINCT k
    FROM unnest(
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(r.permissions -> 'keys', '[]'::jsonb)))
      || CASE WHEN r.permissions -> 'keys' ? 'settings.manage'
              THEN ARRAY['settings.general', 'sales.settings', 'products.manage', 'assignment.manage'] ELSE ARRAY[]::text[] END
      || CASE WHEN r.permissions -> 'keys' ? 'flows.edit'
              THEN ARRAY['flows.publish', 'webhooks.manage'] ELSE ARRAY[]::text[] END
      || CASE WHEN r.permissions -> 'keys' ? 'team.manage'
              THEN ARRAY['team.view', 'team.invite'] ELSE ARRAY[]::text[] END
      || CASE WHEN r.permissions -> 'keys' ? 'roles.manage'
              THEN ARRAY['roles.view'] ELSE ARRAY[]::text[] END
      || CASE WHEN r.permissions -> 'keys' ? 'integrations.manage'
              THEN ARRAY['integrations.view', 'channels.manage'] ELSE ARRAY[]::text[] END
      || CASE WHEN r.permissions -> 'keys' ? 'agents.edit'
              THEN ARRAY['ai_tasks.manage', 'ai_limits.manage'] ELSE ARRAY[]::text[] END
      || CASE WHEN r.permissions -> 'keys' ? 'contacts.edit'
              THEN ARRAY['contacts.assign'] ELSE ARRAY[]::text[] END
    ) AS k
    WHERE k <> 'settings.manage'
  ))
)
WHERE r.system_role IS NULL
  AND r.permissions -> 'keys' ?| ARRAY['settings.manage', 'flows.edit', 'team.manage', 'roles.manage', 'integrations.manage', 'agents.edit', 'contacts.edit'];
