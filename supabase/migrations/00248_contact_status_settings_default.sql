-- ============================================================
-- 00248_contact_status_settings_default
-- ============================================================
-- Corrige la 00245: el DEFAULT de `workspaces.contact_status_settings` llamaba a
-- `private.default_contact_status_settings()`, y esa funcion no la puede
-- ejecutar quien inserta (se le sacaron los permisos a proposito). Un DEFAULT
-- se evalua con los permisos de quien hace el INSERT, asi que crear un
-- workspace fallaba con "permission denied for function
-- default_contact_status_settings" (lo encontro `verify-contact-pipeline.mjs`).
--
-- El DEFAULT pasa a ser el MISMO valor escrito como literal: no depende de
-- ningun permiso. La funcion se queda (la usa `set_contact_status`, que corre
-- como su duenio). `lib/contacts/statuses.test.ts` compara este literal con
-- `DEFAULT_CONTACT_STATUSES`.
--
-- No cambia ninguna fila: los workspaces que ya existen tienen su valor.
--
-- Como volver atras (vuelve al error, no conviene):
--   ALTER TABLE public.workspaces ALTER COLUMN contact_status_settings
--     SET DEFAULT private.default_contact_status_settings();
--
-- Idempotente: SET DEFAULT se puede repetir.
-- ============================================================

ALTER TABLE public.workspaces
  ALTER COLUMN contact_status_settings SET DEFAULT $defaults${
    "setter": [
      {"key": "nuevo", "name": "Nuevo", "color": "#64748b", "archived_at": null},
      {"key": "contactado", "name": "Contactado", "color": "#2563eb", "archived_at": null},
      {"key": "en_conversacion", "name": "En conversación", "color": "#0891b2", "archived_at": null},
      {"key": "calificado", "name": "Calificado", "color": "#16a34a", "archived_at": null},
      {"key": "agendado", "name": "Agendado", "color": "#7c3aed", "archived_at": null},
      {"key": "no_calificado", "name": "No calificado", "color": "#ca8a04", "archived_at": null},
      {"key": "perdido", "name": "Perdido", "color": "#e11d48", "archived_at": null}
    ],
    "closer": [
      {"key": "llamada_agendada", "name": "Llamada agendada", "color": "#7c3aed", "archived_at": null},
      {"key": "no_se_presento", "name": "No se presentó", "color": "#ca8a04", "archived_at": null},
      {"key": "en_seguimiento", "name": "En seguimiento", "color": "#0891b2", "archived_at": null},
      {"key": "propuesta_enviada", "name": "Propuesta enviada", "color": "#2563eb", "archived_at": null},
      {"key": "ganado", "name": "Ganado", "color": "#16a34a", "archived_at": null},
      {"key": "perdido", "name": "Perdido", "color": "#e11d48", "archived_at": null}
    ]
  }$defaults$::jsonb;
