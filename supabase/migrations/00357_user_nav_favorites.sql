-- ============================================================
-- 00357_user_nav_favorites.sql
--
-- La pantalla favorita de cada seccion del menu, por PERSONA (no por
-- workspace): un click en el titulo de una seccion cerrada la abre y lleva a
-- su favorita. Va en `user_preferences` para que siga a la persona entre la
-- computadora y el celular.
--
-- Forma: { "<grupo>": "<href de un item de ese grupo>" }, por ejemplo
-- { "ventas": "/dashboard/contacts" }. La lista blanca de grupos y hrefs vive
-- en el codigo (`parseNavFavorites` / `isFavoriteCandidate`, lib/nav/items.ts):
-- un valor que no encaja se ignora al leer y se rechaza al guardar. Una
-- favorita de una pantalla que la persona no ve en este workspace se ignora.
--
-- Aditiva: puede ir antes o despues de desplegar el codigo. Sin ella, el menu
-- funciona igual pero sin favoritas (la lectura cae a {}).
--
-- La RLS de `user_preferences` (00121: cada uno ve, crea y edita solo su
-- fila) alcanza. Los privilegios de la tabla son de tabla, no por columna,
-- asi que la columna nueva queda cubierta.
--
-- Volver atras:
--   ALTER TABLE public.user_preferences DROP COLUMN IF EXISTS nav_favorites;
-- ============================================================

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS nav_favorites jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_nav_favorites_check') THEN
    ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_nav_favorites_check
      CHECK (jsonb_typeof(nav_favorites) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.user_preferences.nav_favorites IS
  'Pantalla favorita de cada seccion del menu: { grupo: href }. La valida el codigo (lib/nav/items.ts).';
