# Pendientes: Equipo, roles, permisos e invitaciones

Formato: **qué quedó** / por qué / qué se decidió.

## Decisiones tomadas antes de construir (13/10/2026)

- **`triggers` pasa a `flows.edit`** — por qué: hoy un Member publica un flujo y sus disparadores no se guardan (la RLS pide Admin y el insert falla en silencio). Decidido: sí; es el cambio M7 del Member.
- **Se tocan 10 políticas fuera del §8.4** (2 de webhooks y 8 de `settings.manage`) — por qué: con `has_permission` v2 el Member leería webhooks, y `settings.manage` desaparece. Decidido: sí.
- **El menú del Member queda idéntico**; Integraciones no aparece en su menú pero por URL ve solo "Mis conexiones" (M8).
- **Roles personalizados conservan lo que pueden**: las claves que se parten suman sus sucesoras (tabla en el plan §3).
- **El Member pierde Broadcasts** (M6).
- **Cuatro acciones quedan como hoy para el Member**: descartar sugerencia de fusión, revertir acción del agente, quitar "no contactar", inscribir en secuencia.
- **Se cierra el agujero de `workspace_invites_update`**: la rama del invitado sale en la `00212`.

## Para B6 (al cierre)

- Limpiar los roles `zz-test-alcance-*` y los workspaces `zz-test-` sin miembros — por qué: restos de pruebas; el plano pide no borrarlos en este Extra. Verificado el 13/10: no hay workspaces reales sin miembros.
- Transferir la propiedad (`workspace.transfer`) queda como clave reservada, sin construir.
- `workspace_invites_select` deja ver todas las invitaciones del workspace a cualquier miembro; no está en el §8.4 y no se toca.

## Trabado / fallado

_(nada todavía)_
