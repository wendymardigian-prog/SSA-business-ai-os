-- ============================================================================
-- 00240 — Areas "Equipo" y "Otros" en la agenda (B1)
-- ============================================================================
-- Las areas de sistema eran dos (Ventas y Servicio). Se suman:
--
--   Equipo  (reuniones internas, uno a uno, entrevistas a candidatos)
--           tipos: Reunión interna, Uno a uno, Entrevista
--   Otros   (lo que no entra en las otras tres)
--           tipos: General
--
-- Las entrevistas de candidatos son del area Equipo: es trabajo de armar el equipo.
--
-- NO TOCA NADA DE LO EXISTENTE:
--   - Ninguna reunion ni evento cambia de categoria: el `category_snapshot` que
--     cada agenda congelo al crearse sigue igual (renombrar o sumar areas nunca
--     cambia el significado de un informe viejo).
--   - Una area que el negocio ya hubiera creado con el mismo nombre (por ejemplo
--     un "Equipo" propio) NO se pisa ni se convierte en de sistema: se la respeta y
--     no se le agregan tipos. Solo se crea lo que falta.
--   - Ventas y Servicio quedan como estan, con los tipos que cada negocio les haya dejado.
--
-- Las areas de sistema se renombran pero no se archivan (como Ventas y Servicio).
-- No hay una cuarta categoria "personalizada" nueva: se pueden seguir creando areas
-- propias como hasta hoy.
--
-- La logica de crear va en una funcion que se llama para un workspace (`...for_workspace`):
-- la usan el trigger de los workspaces nuevos y el backfill de los que ya existen, asi las
-- dos hacen exactamente lo mismo. Idempotente: correrla dos veces no duplica nada.
--
-- Las mismas areas y tipos que SYSTEM_AREAS en lib/scheduling/categories.ts
-- (lib/scheduling/categories-seed.test.ts compara las dos listas).
--
-- Para volver atras: dejar de crearlas (reponer la funcion de la 00097) y archivar a
-- mano las dos areas nuevas; ninguna reunion las usa hasta que alguien las elija.

CREATE OR REPLACE FUNCTION public.seed_booking_categories_for_workspace(p_workspace uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_area uuid;
  v_pos integer;
  a record;
  t text;
  t_pos integer;
BEGIN
  FOR a IN
    SELECT * FROM (VALUES
      ('Ventas',   '#2563eb', ARRAY['Triaje', 'Cierre', 'Seguimiento']),
      ('Servicio', '#0d9488', ARRAY['Onboarding', 'Uno a uno']),
      ('Equipo',   '#7c3aed', ARRAY['Reunión interna', 'Uno a uno', 'Entrevista']),
      ('Otros',    '#ca8a04', ARRAY['General'])
    ) AS x(name, color, types)
  LOOP
    SELECT id INTO v_area
    FROM public.booking_categories
    WHERE workspace_id = p_workspace AND parent_id IS NULL AND archived_at IS NULL AND lower(name) = lower(a.name)
    LIMIT 1;

    -- Ya existe (de sistema o creada por el negocio): se respeta tal cual, sin tocar sus tipos.
    IF v_area IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT coalesce(max(position), -1) + 1 INTO v_pos
    FROM public.booking_categories
    WHERE workspace_id = p_workspace AND parent_id IS NULL;

    INSERT INTO public.booking_categories (workspace_id, name, color, position, is_system)
    VALUES (p_workspace, a.name, a.color, v_pos, true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_area;

    IF v_area IS NULL THEN
      CONTINUE;
    END IF;

    t_pos := 0;
    FOREACH t IN ARRAY a.types LOOP
      INSERT INTO public.booking_categories (workspace_id, parent_id, name, position, is_system)
      VALUES (p_workspace, v_area, t, t_pos, true)
      ON CONFLICT DO NOTHING;
      t_pos := t_pos + 1;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_booking_categories_for_workspace(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_booking_categories_for_workspace(uuid) TO service_role;

-- El trigger de los workspaces nuevos (la 00097 lo definia con las dos areas): ahora crea las cuatro.
CREATE OR REPLACE FUNCTION public.seed_booking_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.seed_booking_categories_for_workspace(NEW.id);
  RETURN NEW;
END;
$$;

-- Los workspaces que ya existen: se suman las dos areas que les faltan.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.workspaces LOOP
    PERFORM public.seed_booking_categories_for_workspace(r.id);
  END LOOP;
END $$;

COMMENT ON COLUMN public.booking_categories.is_system IS
  'Ventas, Servicio, Equipo y Otros vienen precargadas: se renombran pero no se archivan.';
