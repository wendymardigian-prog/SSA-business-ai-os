-- ============================================================
-- 00121_user_preferences.sql
--
-- Zona horaria por usuario (no por workspace): cada persona ve la bandeja,
-- los dashboards y los filtros en SU zona, detectada del navegador la
-- primera vez que entra y editable despues desde el menu de perfil.
--
-- Independiente del workspace a proposito: es una preferencia de la PERSONA,
-- no del negocio. `workspaces.timezone` sigue existiendo y sigue siendo la
-- que usan las reglas que no pueden depender de quien mira (horario de
-- atencion del agente, topes diarios de gasto de IA, hora de las tareas
-- programadas) — ver 00122.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone        text NOT NULL,
  -- 'browser': se detecto sola y se guardo en el primer ingreso.
  -- 'manual': la persona la cambio a mano desde el menu de perfil.
  -- Una vez 'manual', no se vuelve a pisar sola (components/timezone-bootstrap.tsx).
  timezone_source text NOT NULL DEFAULT 'browser',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_timezone_source_check') THEN
    ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_timezone_source_check
      CHECK (timezone_source IN ('browser', 'manual'));
  END IF;
END $$;

COMMENT ON TABLE public.user_preferences IS
  'Preferencias por persona, no por workspace. Hoy solo la zona horaria.';

CREATE OR REPLACE FUNCTION public.set_updated_at_user_preferences()
RETURNS trigger AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON public.user_preferences;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_user_preferences();

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Cada uno ve, crea y edita UNICAMENTE su propia fila. No depende de ningun
-- workspace ni de is_workspace_member: es pura identidad (auth.uid()).
DROP POLICY IF EXISTS user_preferences_select ON public.user_preferences;
CREATE POLICY user_preferences_select ON public.user_preferences
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_preferences_insert ON public.user_preferences;
CREATE POLICY user_preferences_insert ON public.user_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_preferences_update ON public.user_preferences;
CREATE POLICY user_preferences_update ON public.user_preferences
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Sin policy de DELETE a proposito: se borra sola en cascada si se borra el
-- usuario (ON DELETE CASCADE arriba). Nadie necesita borrar su propia fila;
-- "quiero que se vuelva a detectar" es simplemente cambiarla a mano.
