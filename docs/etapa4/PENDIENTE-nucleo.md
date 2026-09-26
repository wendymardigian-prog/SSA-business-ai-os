# Pendientes — Etapa 4, Tanda A (núcleo)

Lo que quedó sin cerrar en la tanda A, para que lo retome la Tanda B o Wendy. Formato de cada entrada:

- **Qué quedó:** …
- **Por qué:** …
- **Qué se decidió en su lugar:** …

---

## Reglas para la Tanda B (de Wendy, 26/9/2026)
- **Qué quedó:** las migraciones de la Etapa 4 y los scripts `verify-*` no se escriben ni se corren en esta tanda.
- **Por qué:** la tanda A es solo código puro; y otra sesión construye la Etapa 2 sobre la misma base de Supabase.
- **Qué se decidió en su lugar:** la Etapa 4 toma la banda de migraciones **desde `00121`** (la Etapa 2 usa `00081+`); verificar con `list_migrations` justo antes de aplicar. Los scripts `verify-*` borran todos los datos `zz-test-` y se pisan entre sesiones: **no correrlos en simultáneo** con la sesión de la Etapa 2.
