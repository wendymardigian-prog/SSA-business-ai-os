# Bloque G — Integraciones (G1 a G10)

**Rama:** `feat/integraciones-dos-secciones` (worktree aparte, `../ssa-integraciones`,
desde `main`). **Migraciones:** ninguna, como pedía el bloque.

## Punto de partida

- `main` estaba sano: `npx vitest run` → 345 archivos, 4274 tests, 0 en
  rojo. `npm run build` compila.
- **El Bloque S (Configuración) no estaba construido** (el prompt del
  bloque lo pedía como requisito previo). Decidido con Wendy: se hace G
  primero, en su propio worktree desde `main`; S se mergea después, encima.

## Las cuatro confirmaciones del documento

- **a) Mitad cierta.** La pantalla nunca pasa `connection` ni
  `requiredScopes` a `integrationStatus()` (eso sí era cierto), pero
  `oauth_connections` no la lee *solo* el cron: también Agenda,
  `metrics-sync`, `publishing/credentials` y `syncSocialAccounts`. Lo cierto
  es que **ninguna pantalla de Integraciones** la leía. No cambió el plan.
- **b) Cierta.** Una sola entrada `zernio`.
- **c) Cierta.** Postproxy no aparece en el `switch` de `readAccount()`.
- **d) Cierta.** Sin scopes de Drive; `google_calendar` es un adaptador
  aparte, por persona, en Agenda.

## Hallazgos que el documento no tenía

1. **Enchufar G3 tal cual ponía a Google en rojo para siempre.** Su access
   token dura 1 hora y se renueva solo; pasarlo tal cual a
   `integrationStatus()` diría "El acceso venció" permanentemente.
   Resuelto con `toConnectionRef()` (`lib/integrations/connection-ref.ts`):
   si el adaptador sabe renovar (Google, Threads) se usa
   `refresh_expires_at`; si no (LinkedIn), `token_expires_at`. Mismo
   criterio que ya usa `planRefresh()` del cron.
2. **Dos umbrales de 7 días en el sistema.** `WARN_WHEN_DAYS_LEFT` del cron
   de renovación ahora **es** `EXPIRY_WARNING_DAYS` de `status.ts`.
3. **Actividad tiene poco para mostrar**, porque `audit_log` solo registra
   guardar/desconectar. Decidido con Wendy: se muestra lo que hay, más el
   estado actual de la conexión OAuth. Anotado en `docs/PENDIENTE.md`.
4. **Meta no publica**, solo lee anuncios y audiencia. Decidido con Wendy:
   su chip es solo "Anuncios", no "Publicación".
5. El `redirect_to` de OAuth siempre vuelve al listado, nunca al detalle
   (`safeRedirect` tiene una lista cerrada de rutas). Anotado.
6. El detalle nuevo es la 13ª página con `requireWorkspaceAdmin`:
   `member-baseline.test.ts` se actualizó (de doce a trece).
7. Preexistente: una integración OAuth con Client ID/Secret guardados pero
   sin autorizar la cuenta queda "Conectada" igual. No se cambió el
   estado; la card lo dice ("Falta autorizar la cuenta").

## Qué se hizo

| Paso | Commit | Qué cambia |
|---|---|---|
| 0 | `test:` | Caracterización: los 14 ids del catálogo y lo que devuelve `providersBySection()`, antes de tocar nada. Sigue en verde al final: el conjunto no cambió. |
| G10 | `chore:` | Se borra `MigrateToVault`, `zernioLegacySecrets`, `migrateZernioSecretsToVault` y sus tests. Único bloque de limpieza que entraba en este bloque. |
| G1 | `feat:` | `SECTION_ORDER` pasa de 6 a 2 (`connections`, `ai`). Chips de tipo (`mensajeria`/`publicacion`/`anuncios`/`email`) derivados de `type`, con `types` para pisarlos (Zernio: mensajería + publicación). `lib/integrations/grid-filter.ts` aplica chip + "Requiere atención". Dos tests viejos de secciones se reescriben. |
| G3 | `feat:` | `lib/integrations/connection-ref.ts` (`toConnectionRef`, `requiredScopesFor`) y `lib/integrations/load.ts` (mueve el armado de `page.tsx`, suma la lectura de `oauth_connections`). `integrationStatus()` no cambió de firma ni de lógica; `status.test.ts` no se tocó. |
| G2 + G1 UI | `feat:` | La card gana chips, todas las razones (+"N más"), fecha de conexión y vencimiento/renovación OAuth; el botón navega al detalle. El chip y "Requiere atención" viven en la URL (`?tipo=`, `?atencion=1`) y sobreviven la ida y vuelta. |
| G4 | (mismo commit) | `GoogleServices`: YouTube (de la conexión `google`) y Google Calendar (cuántas personas, link a Agenda) por separado. Sin botón para conectar Calendar; Drive no se menciona. |
| G5 | (mismo commit) | Ruta nueva `/dashboard/settings/integrations/[providerId]`, tres pestañas (Credenciales/Cuentas/Actividad). `IntegrationModal` se borra. `PAGE_META` y `member-baseline.test.ts` suman la página. |
| G6 | (mismo commit) | Cuentas de Evolution: el mismo `connection_status`/`last_error` que `/dashboard/channels`, con link ahí para el QR. Sin gestión de instancias. |
| G7 | (mismo commit) | `setDefaultPublisher` (`lib/actions/social-accounts.ts`) guarda `social_accounts.default_publisher` a mano. `lib/integrations/metrics-source.ts` con la línea de "por dónde sale cada red" y un test estructural contra el `switch` de `readAccount()`. |
| G8 | (mismo commit) | Franja de primera conexión (`lib/integrations/onboarding.ts` + `onboarding-banner.tsx`), descarte en `localStorage`, vuelve a los 7 días. |
| G9 | (mismo commit) | Test estructural: ningún link interno a `/dashboard/channels` apunta a una ruta inexistente. |

## Verificación

- `npx vitest run`: **356 archivos, 4338 tests**, 0 en rojo. Suma 66 tests
  nuevos sobre el punto de partida.
- Los cuatro tests estructurales de la §2.6 del documento, verificados por
  nombre: `lib/nav/items.test.ts`, `lib/auth/member-baseline.test.ts`
  (ahora 13 páginas), `lib/nav/page-actions.test.ts` (con la ruta nueva en
  `PAGE_META`), `lib/vault-boundary.test.ts` (42 tests, el catálogo y los
  componentes nuevos no arrastran Vault al cliente).
- `npm run build`: compila sin errores. Las dos rutas de Integraciones
  aparecen como `ƒ` (dinámicas).
- `node scripts/verify-rls.mjs` contra la base real: **todo verde**, limpió
  sus `zz-test-*`.
- **Capturas a 1440/390 px: pendientes.** El panel de vista previa de esta
  sesión quedó atado al checkout principal (`SSA-business-ai-os`), donde
  ya corre el servidor de dev de otra sesión en paralelo — no pude levantar
  uno propio sin tocar el de esa sesión, y no lo voy a tocar. Falta esto
  para cerrar el bloque del todo.

## Lo que quedó fuera (en `docs/PENDIENTE.md`)

- WhatsApp (Evolution): sin gestión de varias instancias.
- La pestaña Actividad no audita conectar por OAuth ni renovar (solo lo
  que ya auditaba: guardar/desconectar).
- El `redirect_to` de OAuth vuelve siempre al listado, no al detalle.

## No tocado (según el documento)

`integrationStatus()`/`status.test.ts`, `testConnection`,
`saveIntegration`, `disconnectIntegration`, el flujo de OAuth completo,
Vault, `lib/secret-names.ts`, `/dashboard/channels` (la pantalla entera se
conserva), cero migraciones, cero proveedores nuevos.
