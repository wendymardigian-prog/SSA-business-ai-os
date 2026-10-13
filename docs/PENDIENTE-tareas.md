# Pendientes — Sistema de Tareas

Formato: **qué quedó** / por qué / qué se decidió.

## Fusión de contactos
- **Qué quedó:** `linkContacts` (`lib/actions/contacts.ts`) reapunta conversaciones, canales y tags al contacto principal pero no conoce `tasks`. Una tarea ligada al contacto duplicado conserva su `contact_id` (el duplicado queda con `deleted_at`).
- **Por qué:** el plano prohíbe tocar la fusión de contactos.
- **Decisión:** no se toca; revisar en una fase posterior si hace falta reapuntar `tasks.contact_id`.

## Baseline de los `verify-*.mjs`
- **Qué quedó:** no se corrieron en la etapa de plan.
- **Por qué:** escriben datos de prueba en la base real.
- **Decisión:** se corren en serie al arrancar T1 y se registra el resultado en PROGRESS.

## Documentos de contexto ausentes
- **Qué quedó:** `claude/v10/alcance-v10.md` e `investigacion-sistema-tareas.md` no están en el repo.
- **Por qué:** solo se entregó el plano (copiado a `docs/requerimientos-tareas.md`).
- **Decisión:** el plano manda; pedirlos si hace falta.

## F25 (triggers sin contacto)
- **Qué quedó:** requiere ampliar el CHECK de `automation_events` y el enrutado del cron por fila.
- **Decisión:** se construye "también sin contacto"; si el cambio del motor es desproporcionado, se difiere y se avisa antes de recortar.
