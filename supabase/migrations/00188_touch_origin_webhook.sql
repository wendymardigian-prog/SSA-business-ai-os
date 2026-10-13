-- ============================================================================
-- 00188 — Webhooks entrantes: el origen `webhook` en `contact_touches`  (M3 del Extra L)
-- ============================================================================
-- El paso «Crear o actualizar contacto» de un flujo de webhook anota un toque con
-- `origin = 'webhook'`. SOLO SUMA un valor al CHECK; ninguna fila existente cambia (los toques
-- viejos son dm, comment, booking, form, manual o import). `record_contact_touch` NO se toca:
-- recibe el origen en el jsonb y la base lo valida contra este CHECK.
--
-- Definicion VIEJA (pg_get_constraintdef, base viva el 12/10/2026):
--   CHECK ((origin = ANY (ARRAY['dm'::text, 'comment'::text, 'booking'::text, 'form'::text, 'manual'::text, 'import'::text])))
--
-- Como volver atras:
--   (antes) DELETE FROM public.contact_touches WHERE origin = 'webhook';  -- y refrescar contacts.attribution
--   ALTER TABLE public.contact_touches DROP CONSTRAINT IF EXISTS contact_touches_origin_check;
--   ALTER TABLE public.contact_touches ADD CONSTRAINT contact_touches_origin_check
--     CHECK (origin IN ('dm', 'comment', 'booking', 'form', 'manual', 'import'));
-- Riesgo: bajo (aditiva).
-- ============================================================================

SET search_path = '';

ALTER TABLE public.contact_touches DROP CONSTRAINT IF EXISTS contact_touches_origin_check;
ALTER TABLE public.contact_touches ADD CONSTRAINT contact_touches_origin_check
  CHECK (origin IN ('dm', 'comment', 'booking', 'form', 'manual', 'import', 'webhook'));
