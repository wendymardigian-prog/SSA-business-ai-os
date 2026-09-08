-- ============================================================
-- MIGRACION 00034 — SOLO OWNER Y ADMIN DEFINEN CAMPOS PERSONALIZADOS (F6)
-- ============================================================
-- Hasta ahora no habia forma de crear un campo personalizado desde la app: las
-- definiciones solo existian si alguien escribia SQL a mano. La pantalla que
-- llega con este bloque cambia eso, y antes de abrirla hay que arreglar quien
-- puede usarla.
--
-- La policy que venia del fork es una sola, `for all`, con
-- is_workspace_member: cualquier Member podia crear, renombrar y BORRAR
-- definiciones. Borrar una definicion no es un cambio menor — el cascade se
-- lleva los valores de todos los contactos — asi que se parte en dos: leer lo
-- puede hacer cualquiera (la ficha del contacto necesita las definiciones para
-- mostrar los campos), definir es de Owner y Admin.
--
-- Se agrega tambien deleted_at, y esto merece explicacion porque cambia una
-- regla del fork: contact_custom_fields.field_id es ON DELETE CASCADE, o sea
-- que borrar una definicion destruye en silencio el valor que ese campo tenia
-- en cada contacto, sin vuelta atras. La regla del proyecto es que nada se
-- borra de verdad (F15), asi que la pantalla marca la definicion como borrada
-- en vez de borrarla: el campo desaparece de la UI y los valores quedan por si
-- fue un error.
--
-- El slug NO se toca al renombrar, y por eso lleva su comentario: el flow
-- builder busca los campos por slug (engine.ts) y esos slugs viven adentro del
-- JSON de los flows, que nada migra. Cambiarlo dejaria a los flows sin
-- encontrar el campo, y ese nodo falla en silencio.
-- ============================================================

ALTER TABLE public.custom_field_definitions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_alive
  ON public.custom_field_definitions(workspace_id, name)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.custom_field_definitions.slug IS
  'Identificador estable del campo. Se genera del nombre al crearlo y NO cambia al renombrar: el flow builder busca los campos por slug y esos slugs viven adentro del JSON de los flows, que nada migra.';

COMMENT ON COLUMN public.custom_field_definitions.deleted_at IS
  'Borrado logico. Borrar de verdad la definicion se llevaria por cascade el valor que ese campo tenia en cada contacto.';

-- ------------------------------------------------------------
-- Las policies: leer todos, definir solo Owner y Admin
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view custom fields in their workspaces" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "Users can manage custom fields in their workspaces" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "custom_field_definitions_select" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "custom_field_definitions_insert" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "custom_field_definitions_update" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "custom_field_definitions_delete" ON public.custom_field_definitions;

-- Las borradas siguen siendo visibles para el SELECT: la app filtra por
-- deleted_at donde corresponde, y dejarlas fuera de la policy romperia el
-- JOIN de contact_custom_fields con valores de un campo ya borrado.
CREATE POLICY "custom_field_definitions_select" ON public.custom_field_definitions
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY "custom_field_definitions_insert" ON public.custom_field_definitions
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "custom_field_definitions_update" ON public.custom_field_definitions
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- Sin policy de DELETE: la pantalla marca deleted_at. Que la base tampoco lo
-- permita evita que un borrado accidental se lleve los valores por cascade.
