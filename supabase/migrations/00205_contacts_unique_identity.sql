-- ============================================================================
-- 00205 — Indices unicos del telefono y del email principal (Contactos: regla unica, C3)
-- ============================================================================
-- La regla central (00200) y sus bloqueos evitan los duplicados que nacen por una carrera, pero la
-- base tambien tiene que impedirlos: un telefono o un email principal solo puede ser de UN contacto
-- vivo por workspace.
--
--   * uq_contacts_workspace_phone  -> (workspace_id, phone)                  donde deleted_at IS NULL
--   * uq_contacts_workspace_email  -> (workspace_id, normalize_email(email)) donde deleted_at IS NULL
--
-- Solo cuentan los contactos vivos (`deleted_at IS NULL`): un contacto borrado o fusionado no bloquea
-- el dato. Solo el telefono y el email PRINCIPALES: el WhatsApp y el email secundario pueden repetirse
-- con el principal de la misma persona. Restaurar un contacto borrado cuyo dato ya es de otro falla con
-- un error claro (lo traduce lib/contacts/unique-errors.ts).
--
-- SE APLICA DESPUES DE DESPLEGAR el codigo de este PR: con el codigo anterior en produccion, la fusion
-- de contactos (`linkContacts`) rellenaba el principal ANTES de borrar el duplicado y habria perdido el
-- relleno en silencio. Aborta (RAISE EXCEPTION) si encuentra un duplicado vivo: se resuelven a mano antes
-- (la consulta esta en docs/PENDIENTE-contactos.md).
-- Idempotente (IF NOT EXISTS).
--
-- Como volver atras:
--   DROP INDEX IF EXISTS public.uq_contacts_workspace_phone;
--   DROP INDEX IF EXISTS public.uq_contacts_workspace_email;
-- ============================================================================

DO $$
DECLARE
  v_phone integer;
  v_email integer;
BEGIN
  SELECT count(*) INTO v_phone FROM (
    SELECT 1 FROM public.contacts
    WHERE deleted_at IS NULL AND phone IS NOT NULL AND btrim(phone) <> ''
    GROUP BY workspace_id, phone HAVING count(*) > 1
  ) d;
  SELECT count(*) INTO v_email FROM (
    SELECT 1 FROM public.contacts
    WHERE deleted_at IS NULL AND public.normalize_email(email) IS NOT NULL
    GROUP BY workspace_id, public.normalize_email(email) HAVING count(*) > 1
  ) d;
  IF v_phone > 0 OR v_email > 0 THEN
    RAISE EXCEPTION '00205: hay contactos vivos duplicados (% por telefono, % por email). Resolverlos a mano antes de crear los indices unicos.', v_phone, v_email;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_workspace_phone
  ON public.contacts (workspace_id, phone)
  WHERE deleted_at IS NULL AND phone IS NOT NULL AND btrim(phone) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_workspace_email
  ON public.contacts (workspace_id, (public.normalize_email(email)))
  WHERE deleted_at IS NULL AND public.normalize_email(email) IS NOT NULL;
