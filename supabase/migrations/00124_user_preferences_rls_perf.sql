-- ============================================================
-- 00124_user_preferences_rls_perf.sql
--
-- Las tres policies de la 00121 llamaban a auth.uid() directo. Postgres la
-- re-evalua fila por fila en vez de una sola vez por consulta (get_advisors,
-- auth_rls_initplan, lo marco apenas se aplico la 00121). Con una sola fila
-- por usuario no se nota, pero el patron correcto es `(select auth.uid())`,
-- que Postgres si puede tratar como estable. Mismo comportamiento, mejor
-- plan.
-- ============================================================

DROP POLICY IF EXISTS user_preferences_select ON public.user_preferences;
CREATE POLICY user_preferences_select ON public.user_preferences
  FOR SELECT USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_preferences_insert ON public.user_preferences;
CREATE POLICY user_preferences_insert ON public.user_preferences
  FOR INSERT WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_preferences_update ON public.user_preferences;
CREATE POLICY user_preferences_update ON public.user_preferences
  FOR UPDATE USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
