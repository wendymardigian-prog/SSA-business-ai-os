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

## Decisiones tomadas mientras se construía

- **`agents` UPDATE también pide `agents.edit`** (el plano §8.4 nombra solo el INSERT) — por qué: las acciones de agentes actualizan con la sesión de la persona; sin esto un rol con `agents.edit` podría crear agentes y no editarlos. El Member no tiene `agents.edit`: no cambia nada para él.
- **`agent_prompt_versions` SELECT pide `agents.edit`, no `agents.view`** (el plano dice `agents.view`) — por qué: el Member tiene `agents.view` y hoy no puede leer el historial de instrucciones; abrírselo habría sido un cambio no aprobado. La pestaña de instrucciones ya pide `agents.edit`.
- **`flows` y `triggers` en la base piden `flows.view` / `flows.edit`** (plano §8.4) — consecuencia a vigilar: los flujos de **Formularios** (`forms.manage`) y de **Agenda** (`scheduling.use`) se escriben con la sesión de la persona. Un rol personalizado que tenga esas claves pero **no** `flows.edit` ya no podrá guardar el flujo de un formulario o de un evento de agenda (antes sí, porque `flows` dejaba escribir a cualquier miembro; los disparadores ya fallaban para quien no era Admin). El Owner, el Admin y el Member de sistema no se ven afectados. El único rol personalizado real (Content Manager) tiene `flows.edit`. Salida si aparece el caso: pasar esas escrituras al cliente de servicio después del guard (como se hizo con `workspaces`), o darle `flows.edit` al rol.
- **`flows.publish` sin `flows.edit`**: publicar escribe `triggers`, que pide `flows.edit`. Por eso el editor de roles encadena `ver ⇒ editar ⇒ publicar` (tildar «publicar» tilda «editar» y «ver»; destildar «ver» saca las otras dos). Un rol armado a mano contra la base, sin esas dos, no puede publicar.
- **Quitar personas**: se mantiene lo de hoy (solo el Owner; nadie se quita a sí mismo; no se quita al último Owner). `team.remove` es una clave solo-Owner: ningún rol la lleva.
- **Desconectar Google Calendar** queda en su pantalla (Agenda → Calendarios); «Mis conexiones» en Integraciones conecta y lleva allá. No se tocó `lib/oauth/*`.
- **Los roles personalizados pierden cuatro agujeros** que tenían sin querer: importar contactos, exportar CSV, webhooks y broadcasts (hoy cualquier miembro los tenía por falta de guard). Si algún negocio los necesitaba, se les tilda la clave nueva en Roles.
- **`workspace_invites_select`** deja ver todas las invitaciones del workspace a cualquier miembro: no está en el §8.4 y no se toca.
- **Tablas hijas de secuencias** (`sequence_steps`, `sequence_enrollments` salvo el DELETE) y `contact_notes`, `agent_drafts`, etc. siguen con su política de siempre (cualquier miembro o Admin): el plano las deja afuera (§8.4, «No se tocan»).
- **Contactos**: `contacts.delete` en la base solo cubre el DELETE de verdad. El borrado lógico es un UPDATE (`deleted_at`) y lo gobierna el alcance de la persona más el guard de la acción; no se tocó `contacts_update`.

- **Unión con `main` y el rediseño del menú de Formularios (14/10/2026)** — `main` sumó el plano `formularios-ui` (PR #52): Conocimiento, Recursos e Integraciones dejan de ser items del menú (Integraciones y Recursos pasan a ser pestañas de Ajustes; Conocimiento, un botón de la barra de Agentes IA) y «Ajustes» pasa a verse para cualquiera que vea al menos una pestaña. Al resolver los conflictos se conservó **su estructura** y se le puso **mi regla por permisos**: `visibleSettingsTabs(can)`, `settingsEntryHref(can)`, `navItemHref(item, { permissionKeys })`, el botón «Conocimiento» pide `knowledge.view`, y `adminOnly`/`isAdmin` desaparecen del menú. **Esto cambia el menú del Member respecto de la decisión M8 del 13/10 («menú idéntico»)**: ahora ve «Ajustes» (entra a Recursos) y no ve «Recursos» como item. No gana ni pierde ningún permiso; es el cambio aprobado de formularios-ui. La foto de la matriz de acceso compara el menú como conjunto con esa excepción documentada.

## Incidentes de la corrida (sin pérdida de datos)

- **La CLI de Supabase falla por momentos** con «too many authentication failures / circuit breaker» cuando varias sesiones consultan a la vez; se resolvió esperando y reintentando con pausas largas. Una consulta colgada de `verify-tasks` se cortó a mano y dejó 18 workspaces `zz-test-`: se limpiaron con `runCleanup` antes de seguir.
- **Candado de verificaciones**: el candado `/private/tmp/ssa-verify.lock` que tomé quedó ocioso más de 15 minutos mientras la base estaba bloqueada y otra sesión (Formularios) lo tomó, como indica el protocolo. Una corrida mía de `verify-roles` coincidió con su `verify-forms` y las dos limpiezas se pisaron (a ella le borré dos usuarios `zz-test-forms-*`). Desde entonces corro todo con el mismo protocolo del candado (`mkdir` para tomarlo, `rmdir` para soltarlo, sin retenerlo en espera). Si su `verify-forms` de ese momento falló, hay que repetirlo.
- **00212 corregida después de aplicarse**: el trigger `workspace_roles_grant_check` corría con los permisos de quien edita y no podía llamar a las funciones de `private`; lo detectó `verify-roles` (dos casos que debían permitirse fallaron). Se pasó a `SECURITY DEFINER`, se reaplicó el archivo (es idempotente) y se actualizó lo registrado en `schema_migrations`. Los chequeos de «denegado» ahora exigen el mensaje del trigger para no pasar «en vacío» por otro error.

## Para B6 (al cierre)

- Limpiar los roles `zz-test-alcance-*` y los workspaces `zz-test-` sin miembros — por qué: restos de pruebas; el plano pide no borrarlos en este Extra. Verificado el 13/10: no hay workspaces reales sin miembros.
- Transferir la propiedad (`workspace.transfer`) queda como clave reservada, sin construir. Lo mismo `scheduling.team_events`.
- Revisión visual (1440 y 390 px, claro y oscuro) de Equipo, Roles, General, Integraciones y menú: ver «Trabado / fallado».

## Trabado / fallado

- **Revisión visual sin hacer** (Equipo, Roles, General, Integraciones y menú; 1440 y 390 px; claro y oscuro) — por qué: el navegador de Claude no tiene sesión y el login va contra la base real; no se escriben credenciales. Se decidió dejarla para Wendy con una sesión real.
- **`verify-contacts-single-entry.mjs` falló dos veces** (muy probablemente un problema previo del script: `main` trae `0ea87d2`, «el verify de la regla unica limpia el contacto de la prueba de indices»; hay que repetirlo con esa corrección) en «sigue habiendo UN contacto» (conteo de contactos de un workspace de prueba) — por qué: no está claro si es mío o preexistente; este script es de la sesión de contactos y no se corrió al empezar. Mi cambio sobre `contacts` es solo la política de DELETE (`contacts.delete`), que el service role no usa. Hay un diagnóstico preparado (copia con el conteo detallado, `scripts/verify-zz-dbg-single.mjs`, sin commitear) que no pudo correr porque la base quedó bloqueada por restos `zz-test-` de otra sesión. **Para retomar**: cuando no queden filas `zz-test-`, correr ese script con el candado y comparar contra `main`.
- Los otros 22 `verify-*` que pasaban al empezar siguen en verde con las siete migraciones aplicadas.
