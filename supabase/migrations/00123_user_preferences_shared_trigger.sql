-- ============================================================
-- 00123_user_preferences_shared_trigger.sql
--
-- La 00121 creaba una funcion de trigger propia para user_preferences
-- (set_updated_at_user_preferences) en vez de reusar la que ya existe para
-- esto mismo en el resto de las tablas (public.update_updated_at, 00001).
-- Duplicar la logica tuvo un costo real: la version nueva no tenia
-- `SET search_path`, que la version compartida sí tiene desde hace rato
-- (get_advisors lo marco como WARN apenas se aplico la 00121).
--
-- Se repunta el trigger a la funcion compartida y se borra la propia.
-- ============================================================

DROP TRIGGER IF EXISTS set_updated_at ON public.user_preferences;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP FUNCTION IF EXISTS public.set_updated_at_user_preferences();
