-- ============================================================================
-- 00177 — Candado en las versiones publicadas (Formularios, correccion R9)
-- ============================================================================
-- Las firmas de contrato ya estan blindadas en la base (`contract_signatures_protect`), pero las VERSIONES
-- (`form_versions`), que guardan el texto del contrato y su huella, solo estaban protegidas porque ninguna
-- pantalla las edita: con el service role se podian cambiar. Este trigger BEFORE UPDATE rechaza cualquier cambio
-- (tambien para el service role) en: workspace_id, form_id, version_number, definition, contract_text,
-- contract_text_sha256, published_by y published_at.
--
-- DELETE no se bloquea: la limpieza de los scripts de verificacion borra en cascada, y borrar un formulario o un
-- workspace tiene que seguir andando.
-- UNA EXCEPCION a "cualquier cambio en published_by": pasar de una persona a NULL. Es lo que hace la clave foranea
-- (`published_by -> auth.users ON DELETE SET NULL`) al borrar al usuario; si el trigger lo frenara, no se podria
-- borrar a quien alguna vez publico algo. Cambiar de una persona a OTRA, o de NULL a alguien, si se rechaza.
-- `updated_at` lo mueve su propio trigger (`set_updated_at`) y no cuenta.
--
-- Riesgo: bajo (aditiva; ninguna pantalla ni funcion actualiza esas columnas: publish_form_version solo inserta).
-- Como volver atras:
--   DROP TRIGGER IF EXISTS form_versions_protect ON public.form_versions;
--   DROP FUNCTION IF EXISTS public.form_versions_protect_published();
-- ============================================================================

CREATE OR REPLACE FUNCTION public.form_versions_protect_published()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.form_id IS DISTINCT FROM OLD.form_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.definition IS DISTINCT FROM OLD.definition
     OR NEW.contract_text IS DISTINCT FROM OLD.contract_text
     OR NEW.contract_text_sha256 IS DISTINCT FROM OLD.contract_text_sha256
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     -- Una persona a NULL es el ON DELETE SET NULL de la clave foranea: se deja pasar.
     OR (NEW.published_by IS DISTINCT FROM OLD.published_by AND NEW.published_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Una version publicada no se puede cambiar' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS form_versions_protect ON public.form_versions;
CREATE TRIGGER form_versions_protect
  BEFORE UPDATE ON public.form_versions
  FOR EACH ROW EXECUTE FUNCTION public.form_versions_protect_published();
