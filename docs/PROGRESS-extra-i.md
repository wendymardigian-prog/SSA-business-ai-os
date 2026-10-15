# Progreso — Extra I (Métodos de pago, Gastos, Atribución orgánica y Comisiones)

Rama `feat/extra-i`. Planos: `claude/v11/requerimientos-extra-i.md` (v1.1) y `claude/v7/gastos/plano/*`. Pendientes y decisiones en `docs/PENDIENTE-extra-i.md`.

> Esto es el plan aprobado el 15/10/2026, escrito tal cual. La construcción lo sigue aunque la conversación se resuma. Releer al empezar cada bloque.

---

# Plan del Extra I — Métodos de pago, Gastos, Atribución orgánica y Comisiones

Rama `feat/extra-i` (worktree `setup-extra-i-b32e9d`, parte de `main` en `4046fb3`). Planos: `claude/v11/requerimientos-extra-i.md` (v1.1, manda) y `claude/v7/gastos/plano/*` con los cambios de §6.2. Este texto se copia tal cual a `docs/PROGRESS-extra-i.md`.

## 0. Contexto

Hoy el sistema no sabe cuánto se queda cada procesador de pagos, no registra gastos, no sabe de qué pieza de contenido viene cada lead y no calcula comisiones. El Extra I lo agrega en 10 bloques, en este orden: **MP → G1 → G2 → G3 → AO1 → AO2 → AO3 → CM1 → CM2 → CM3**. Es un sistema en producción, así que lo primero es no romper nada: cada cambio a algo existente lleva un test de caracterización antes, y las 8 funciones SQL protegidas deben terminar con la misma huella.

Todo lo que sigue se ejecuta **recién después de que aprobés este plan**. En esta etapa no se escribió código ni se tocó la base.

## 1. Punto de partida (medido hoy, 15/10/2026)

| Qué | Resultado |
|---|---|
| `npx vitest run` | **900 archivos, 11.407 tests, todo en verde** (31 s) |
| `npm run lint` | 0 errores, 36 avisos (de `eslint-disable` que ya no hacen falta; no empeorar) |
| Base | Última migración registrada: `00223_content_post_assignee` (la 00220 **sí** está aplicada, aunque el `CLAUDE.md` diga lo contrario). Ninguna otra rama con migraciones ≥ 00224. `payments`: 0 filas. `sales`: 0. `contact_touches`: 834 |
| CHECK de `payments` | `payments_method_check`: `CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['whop','transferencia_cr','transferencia_usa','wise','binance']))))` |
| CHECK de `contact_touches.origin` | `contact_touches_origin_check`: `CHECK ((origin = ANY (ARRAY['dm','comment','booking','form','manual','import','webhook'])))` |

**Huellas de las 8 funciones protegidas** (`md5(pg_get_functiondef(...))`, leídas hoy de la base):

| Función | Huella |
|---|---|
| `record_contact_touch(uuid,uuid,jsonb)` | `2f51ddbf060e31528b89ce7481b38e3d` |
| `find_or_link_contact(uuid,text×6,timestamptz,boolean)` | `0aee03549e9361626ad4720c4a98254a` |
| `find_contact_for_form(uuid,text,text,jsonb)` | `b7b5605c4a19a27865c7915f57c36fe8` |
| `find_or_create_contact(uuid,jsonb,jsonb,text,boolean)` | `a71d6af701ea4460c5309631205de522` |
| `submit_form_response(uuid,uuid,uuid,jsonb×5)` | `78a358d5ac8c4dfebd598bb3f5f91e7c` |
| `create_booking(…25 parámetros)` | `dc462c28e99c353bbc9ca26198eddd64` |
| `create_sale(jsonb,uuid)` | `adb766e6d657bf55db42779c7c53bcb3` |
| `resolve_meta_match(uuid,text×6,…)` | `78aa59a21a64fa73f7e779a2cd1d911a` |

**Lo que todavía no está medido y por qué:** `npm run build` y los `verify-*` (escriben datos de prueba en la base real y generan `.next`), así que no se corren en modo plan. **Primer paso de la ejecución** (antes de MP): copiar el `.env` y enlazar `supabase/.temp` (decidido: opción recomendada; ambos en el `.gitignore`, nunca se imprimen), correr `npm run build` y cada `verify-*` de a uno con el candado `/private/tmp/ssa-verify.lock`, con los flags vigentes (`verify-rls --despues-de-00143`, `verify-roles --despues-de-00136 --despues-de-00208 --despues-de-00211 --despues-de-00212`, `verify-audit-visibility --despues-de-00168`, `verify-permissions-matrix`), y anotar acá cuáles ya fallan. Lo que ya falla se anota; no puede empeorar.

## 2. Diferencias entre el plano y el código real (gana el código)

Cada una con lo que se hace para mantener el comportamiento que pide el plano.

**Métodos de pago / ventas**
1. `planMarkPaid` está en `lib/sales/payments-rules.ts`, no en `payments-core.ts`. La reversión no es de `payments-core`: es `revertPayment` en `lib/actions/payments.ts` con `REVERT_CLEARED_FIELDS` (payments-rules). `writePayment` existe dos veces, privada en cada archivo. → Se cambia donde está la lógica real.
2. **`create_sale` (protegida, no se toca) inserta los pagos con una lista fija de columnas que NO incluye `provider_fee_percent` ni `provider_fee_fixed`** (00169:506-511). Un pago que nace ya cobrado quedaría con esas dos en null. → La 00224 suma un trigger `BEFORE INSERT OR UPDATE` en `payments` (con `EXCEPTION WHEN OTHERS`) que, si el pago está `paid` y las dos columnas vienen null, las copia de `payment_option_snapshot` (que `buildPaymentRows` ya manda con `provider_fee_percent` y `provider_fee_fixed`). `planMarkPaid` las escribe directo.
3. Hoy los 5 métodos tienen comisión 0, **Whop incluido** (decisión del 11/10); no hay UI para cargarla. → El backfill mantiene 0; Wendy carga los reales desde la pantalla nueva.
4. Cada lector de `enabled_payment_methods` (lista completa en §6 MP-F2) usa un default distinto: `lib/actions/sales.ts:105` cae en `[]`, el resto en `DEFAULT_ENABLED_PAYMENT_METHODS`. → Todos pasan a `parsePaymentMethods(workspaces.payment_methods)`. El filtro "método" de la lista de Pagos hoy ofrece los 5 fijos y no valida `metodo`: pasa a la lista del negocio (incluye inactivos, para poder filtrar pagos viejos).
5. La lista de métodos vive en 3 lugares (TypeScript, CHECK de `payments`, CHECK de `workspaces.enabled_payment_methods` de la 00159). El CHECK de `workspaces` queda intacto (la columna queda sin leerse). `fees.test.ts` lee la 00162 con una regex: sigue verde porque el catálogo de arranque conserva las 5 claves originales.
6. `notifyWorkspaceAdmins` está atada a canales; `createNotificationOnce` solo deduplica por tipo + entidad (+ destinatario con `perRecipient`), no agrupa por metadata ni por día; `NotificationEntity` no tiene `sale`/`payment`; `membersWithPermission` fija el alcance a `calls`. → Se usa `createNotification`/`createNotificationOnce` con `recipientId` concreto, se suma la entidad `commission`/`expense` y un helper propio para "Owner/Admin + quienes tienen la clave".
7. Las notificaciones las ve **todo Owner/Admin** (`can_see_notification`, que no se toca): un aviso personal de comisión no es privado frente a ellos. Se documenta.

**Permisos / menú**
8. Hay un 5º test de permisos que el plano no nombra: `member-permissions-characterization.test.ts` (27 claves y alcances del Member con `toEqual`). Se actualiza solo con `commissions.view` como "cambio aprobado M9".
9. **Sumar `commissions` a `SCOPED_MODULES` toca ~12 lugares escritos a mano con los 6 módulos** (`permissions.ts`: `SCOPED_MODULES`, `SYSTEM_ROLE_PERMISSIONS` ×3, `parsePermissions`; `roles-admin.ts`: `SCOPE_GROUP`, `SCOPE_GATES`, `validateRole`; `lib/actions/roles.ts:64,137`; `lib/roles/templates.ts:47-72`; `verify-permissions-matrix.mjs:52`; `roles-admin.test.ts:247`; `docs/roles.md:203`). El plano lo pide así; se hace y se lista cada uno en PROGRESS. Del lado SQL, `permission_scope` y `can_grant_permissions` ya son genéricas.
10. Agregar "Finanzas" al menú rompe 4 tests: `items.test.ts` (l.124, 247), `menu-by-role.characterization.test.ts`, `member-baseline.test.ts` (menú del Member y "la única oculta es Social") y `access-matrix.characterization.test.ts` (compara el menú de Owner/Admin/Member como **conjunto** y su foto "no se toca"). → Se agrega una **excepción explícita de "ítems agregados"** (del estilo de `REMOVED_FROM_MENU`) en vez de regenerar la foto, y se actualizan los otros con comentario "Extra I". Owner/Admin no cambian en nada más.
11. `settings-view.tsx:69` resuelve permisos con una clausura escrita a mano para 2 claves: una clave nueva (`expenses.manage`) devolvería `false` en silencio. → Se generaliza a `can(key)` real. `GeneralSection.id` y `permission` son uniones cerradas: se amplían (`finanzas`, `atribucion`; `expenses.manage`); `general-sections.test.ts` y `tabs.test.ts` se actualizan.
12. `lib/finance/` no existe. `page-actions.test.ts` exige que cada `page.tsx` nueva tenga entrada en `PAGE_META` (o `PAGES_WITHOUT_HEADER`): se suman las de Finanzas. El ícono nuevo hay que agregarlo en `components/sidebar.tsx` (`ICONS`).
13. `member_permission_keys()` vigente (27 claves) está **solo** en la 00208; ninguna posterior la redefine. La migración de comisiones la redefine copiando esa definición letra por letra + `commissions.view`.

**Atribución / flujos**
14. **`create_sale` no recibe parámetros `p_attribution_*`**: la atribución viaja en `p_payload.attribution = {mode:'touch', touch_id}` (queda `attribution_type='manual'`). Hoy una atribución manual **no crea ningún toque**, solo guarda un JSON. → F47 crea el toque con `recordTouch` y manda ese `touch_id`; el modo `manual` viejo sigue aceptado por la base. La **edición** de la venta (`updateSale`) no pasa por `create_sale` (resuelve en TypeScript): el mismo camino crea el toque en la acción.
15. **`content_label` no se decodifica al guardarse** (`campaign`/`content`/`term` solo se recortan; `source`/`medium` sí se normalizan). Los triggers y las condiciones UTM necesitan comparar decodificado y en minúsculas. → El trigger `contact_touches_content_code` y `commission_facts` decodifican en SQL; el gemelo TS reusa `decodeUtm` (`lib/attribution/meta-match.ts`). Los datos guardados no se tocan. El editor avisa que `source` ya viene normalizado (`ig` → `instagram`).
16. **`recordInboundTouch` no resuelve la pieza de una historia**: `storyId` queda solo en `raw.story_id`. Y **no se puede verificar** que `social_posts.external_post_id` de una historia coincida con el `storyId` de Zernio (ningún código ni test los cruza; una historia publicada a mano ni tiene fila). → F33 se construye defensiva (busca por plataforma + `external_post_id`, solo si hay una fila única en el workspace; si no, el toque queda como hoy), se prueba con datos sembrados y queda anotado en PENDIENTE para confirmar en vivo.
17. **`post_id` en las variables de `comment_keyword` es el id de Zernio o de la red, no `social_posts.id`** (`lib/comment-processor.ts:215-220`). → F34 resuelve la publicación por `external_post_id` + plataforma (`contentVariablesFor`, pura). En los disparadores de mensajes el `storyId` no queda en ninguna variable (solo `message` y `message_origin`): se suma.
18. **Las URLs de botones y carruseles no se interpolan** y en WhatsApp se aplanan a texto *antes* de interpolar; el respaldo por respuesta privada manda solo el primer mensaje, sin botones. → La atribución de links se aplica al mensaje ya adaptado, en los tres caminos, y con el interruptor apagado no se toca nada.
19. `SendMessageNodeData` no declara `mediaUrl`/`mediaType` (se leen con cast): no se toca. Solo se suma `attribution?`.
20. Tests que el plano nombra y no existen en esa ruta: no hay `send-message.test.ts` (solo `send-message-characterization.test.ts` con **un** caso), ni `lib/comments/attribution.test.ts` (lo cubren `contact-link.test.ts` y `characterization-c2.test.ts`), ni `lib/sales/payments-core.test.ts`, y el de jobs está en `lib/jobs/bootstrap-characterization.test.ts` (no en `lib/publishing/`). → Se usan los reales; se escriben los que faltan (§5).
21. `pieceOf` (comentarios) no está exportada: se exporta al extraer `lib/comments/link-to-contact.ts`.
22. `vault-boundary.test.ts` solo revisa imports de módulos que empiezan con `lib/forms/` o `lib/antispam/`: `lib/attribution/tracked-link.ts` queda fuera. → Se amplía el filtro del test (más estricto, nunca más laxo) y se suma el módulo a `SERVER_ONLY`. `createServiceClient` está en `lib/supabase/server.ts`.
23. `"l"` no está en `RESERVED_ROUTES` (`lib/site/pages.ts`) ni en `docs/sitio.md`. `/l/[token]` pasa el middleware sin tocarlo (solo `/dashboard` exige sesión).
24. `contact_touches_meta_match` es solo `BEFORE INSERT` (no UPDATE) y `rematch_meta_touches` nunca toca `ignored` ni `manual`: confirmado. Orden alfabético de triggers `content_code` < `meta_match` < `zz_channel`: confirmado. Un origen nuevo (`link_click`) obliga a tocar el CHECK, `ORIGINS`, `ORIGIN_LABELS` (no compila sin etiqueta) y decidir si entra en `private.meta_touch_utm_counts` (00194): **no entra** (un clic es orgánico, no trae datos de anuncio).
25. Gráficos: `BarList` **no** admite color por ítem y `charts.tsx` no tiene dona ni área → componente propio `components/finance/category-bars.tsx` (previsto por el plano de Gastos). `recharts` no se usa en Finanzas.
26. La lista de piezas filtra por autor, no por responsable; `canReassign` decide por rol, no por permiso. → F43 suma el filtro "Responsable"; `canReassign` no se toca. Social **no permite editar** una publicación externa (el panel es de solo lectura): el selector de responsable de una publicación sin pieza va como acción nueva con `content.publish` (el permiso que ya gobierna marcar/desmarcar a mano) — **a confirmar con Wendy en el PR** si prefiere otro.
27. No hay script `typecheck`: se usa `npx tsc --noEmit` además del build.
28. `verify-rls` solo lee `--despues-de-00136` y `--despues-de-00143` (el `--despues-de-00208` de `docs/roles.md` se ignora sin avisar): se usa el vigente y se anota.
29. El `CLAUDE.md` dice "próxima libre 00215" y que la 00220 está sin aplicar: está viejo. Se actualiza al cerrar.
30. El worktree no tiene `.env` ni `supabase/.temp`; la carpeta `claude/` y `docs/referencia/` no están en el worktree (ignoradas): los planos se leen del checkout principal (solo lectura).

## 3. Migraciones

Primer número libre confirmado: **00224** (`list_migrations` y `ls`). Numeración real = la del plano.

| N° | Qué | Quién | Verificación |
|---|---|---|---|
| 00224 | `payment_methods`, `provider_fee_percent/fixed`, trigger `payments_validate_method` (reemplaza `payments_method_check`), trigger de copia desde snapshot, `workspace_payment_method()` | Corrida (bloque MP) | `verify-payment-methods`, `verify-sales` antes y después, `verify-rls` |
| 00225 | `expenses`, `recurring_expenses`, `vendors` (+`user_id`), `finance_settings` jsonb, `expenses_guard`, `expenses_validate_category`, RLS | Corrida (G1) | `verify-expenses`, `verify-rls`, `verify-roles` |
| 00226 | Bucket privado `expense-receipts` | Corrida (G1) | `verify-expenses` |
| 00227 | Política adicional `audit_log_select_finance` | Corrida (G1) | `verify-expenses` (caracterización antes/después), `verify-audit-visibility --despues-de-00168` |
| 00228 | `mark_expenses_overdue`, `private.enqueue_finance_daily` (**sin** `cron.schedule`) | Corrida (G2) | `verify-expenses` |
| 00229 | `upsert_auto_expense` | Corrida (G2) | `verify-expenses` (8 casos de paridad + concurrencia) |
| 00230 | `attribution_code`, `social_posts.assigned_to`, `contact_touches.channel`, `touch_channel()`, 2 triggers, CHECK `origin` + `link_click`, `attribution_settings`, `contact_last_origin_touch()`, `private.enqueue_comment_backfill()`, backfill de `channel` (~834 filas) | Corrida (AO1) | `verify-organic-attribution`, `verify-attribution`, `verify-ads-attribution`, `verify-crm`, `verify-forms`; huella de `record_contact_touch` |
| 00231 | `commission_settings`, `commission_rules`, `commissions`, `can_see_commission`, `commission_content_owner`, `private.member_permission_keys()` (+ `commissions.view`), motor, liquidación, `commissions_guard`, `expenses_release_commissions`, `private.enqueue_commissions_for_payment()` | Corrida (CM1) | `verify-commissions`, `verify-rls`, `verify-roles`, `verify-permissions-matrix` |
| 00232 | Política adicional `audit_log_select_commissions` | Corrida (CM1/CM3) | `verify-audit-visibility` |
| 00233 | `cron.schedule('finance-daily')` | **Wendy, después del merge** | `verify-expenses --despues-de-00233` |
| 00234 | Trigger `contacts_comment_backfill` + barrido inicial | **Wendy, después del merge** | `verify-organic-attribution --despues-de-00234`, `verify-contacts-single-entry` |
| 00235 | Trigger `payments_enqueue_commissions` | **Wendy, después del merge** | `verify-commissions --despues-de-00235`, `verify-sales` |

Reglas para todas: idempotentes (`IF NOT EXISTS`, `DO $$`), cabecera "Como volver atras", `SET search_path = ''`, `SECURITY DEFINER`/`INVOKER` y `REVOKE` según §8.4 del plano. Cuando cambian algo existente (CHECK de `payments`, CHECK de `contact_touches.origin`, `member_permission_keys()`) la cabecera copia la definición vigente leída de la base. Se aplican con `supabase db query --linked -f`, se registran con `INSERT` en `supabase_migrations.schema_migrations` (version = timestamp UTC, name = archivo, `statements = array[<SQL>]`) y después `node scripts/build-all-migrations.mjs`. Si una verificación falla: **parar**, anotar en `PENDIENTE-extra-i.md` qué falló y la vuelta atrás, no seguir. Las 00233–00235 se escriben y se ensayan con `BEGIN; … ROLLBACK;`, y sus funciones de trigger se prueban llamándolas directo en los `verify-*`; **nunca se aplican**.

**Tablas nuevas: solo 5** (`expenses`, `recurring_expenses`, `vendors`, `commission_rules`, `commissions`). Cuatro columnas jsonb en `workspaces`: `payment_methods`, `finance_settings`, `attribution_settings`, `commission_settings`. Responsable de la pieza = `content_posts.assigned_to` (00223), sin tocar su trigger.

## 4. Reglas de toda la corrida

- Dependencias: G1←MP; G2←G1; G3←G2; AO1←MP; AO2 y AO3←AO1; CM1←MP+G1+AO1; CM2←CM1+G1; CM3←CM2; F49←AO1. Si un bloque se traba tras un intento serio: anotar en PENDIENTE y seguir solo con los que no dependen de él.
- Nice-to-have que pueden quedar anotados: F6, F42, F48, F65, GF18, GF27-CAC, GF28 y la duplicación (GF10).
- Nunca debilitar un permiso, un test existente ni una política de RLS. Sin dependencias nuevas. Sin variables de entorno nuevas (el único secreto nuevo, `attribution_link_secret`, se genera solo en Vault). Sin `dangerouslySetInnerHTML`. Sin tocar configuración real (Railway). Ningún test llama a un servicio real (`vitest.setup.ts` bloquea `fetch`).
- No se tocan: las 8 funciones de huella, `contact_touches_meta_match`, `private.call_app_cron`, `audit_log_select`, `can_see_contact/sale/task/notification`, `content_posts_assignee`. El cron de Finanzas es SQL directo (patrón 00167/00198); `lib/cron-config.test.ts` queda intacto.
- Toda regla de la base tiene gemela pura en TS y archivo de casos compartido (patrón `meta-match.cases.json`): `touch_channel` ↔ `lib/attribution/channel.ts` (≥16 casos); `commission_content_owner` ↔ `lib/commissions/content-owner.ts` (≥6); reglas/payee/monto ↔ `lib/commissions/rules.ts` (≥40, con UTM y cada payee); `upsert_auto_expense` ↔ `decideAutoExpenseAction` (8 casos).
- Lo automático nunca tumba lo que lo origina (`EXCEPTION WHEN OTHERS` + `RAISE WARNING`, probado forzando el error). **Única excepción a propósito: `expenses_release_commissions`**, que sí falla la anulación del gasto. Los jobs no lanzan por fallos de proveedor.
- Plata en centavos (`lib/sales/money.ts`), fechas civiles en la zona del workspace (`lib/dates.ts`), nada se borra (se anula/archiva/desactiva). `"use server"`: todo lo exportado es función asincrónica. Nunca `select("*")` sobre `agents`, `agent_runs`, `webhook_endpoints`, `eod_reports`.
- Ritmo: `npx vitest run` tras cada funcionalidad; tras cada bloque marcar `PROGRESS-extra-i.md`, commit `feat: extra-i - bloque X (nombre)` y `git push origin feat/extra-i`. Commits con rutas explícitas (nunca `git add -A`).
- Un `verify-*` por vez, con el candado `/private/tmp/ssa-verify.lock` (`mkdir` para tomar, `rmdir` para soltar; no mantenerlo ocioso).
- Revisión visual por bloque con pantallas, a 1440 y 390 px, tema claro y oscuro, con el navegador de Claude Code. Si pide login, se anota (nunca se escriben credenciales). No bloquea el "listo".
- No se mergea a `main`.

## 5. Tests de caracterización (antes de tocar lo que cada bloque modifica)

| Qué se fija | Estado hoy | Acción |
|---|---|---|
| Cobro con fee **distinto de 0** y snapshot (`planMarkPaid`, `buildPaymentRows`, `revertPayment`) | Solo hay casos con fee 0 | **Escribir** `lib/sales/payments-fee-characterization.test.ts` (2,9 % + 0,30 sobre 500 → 14,80; 416,67×3) antes de MP |
| "Enviar mensaje" (botón URL, carrusel, link en el texto, WhatsApp aplanado, respaldo por respuesta privada) | Un solo caso | **Ampliar** `send-message-characterization.test.ts` copiando el armado vigente (afirmar lo que recibe `sendChannelMessage`) antes de AO2 |
| `attributeComment` Instagram/TikTok | Cubierto por `contact-link.test.ts` y `characterization-c2.test.ts` | Confirmar; agregar el caso "opción apagada = como hoy" antes de AO1 |
| Permisos del Member | `member-baseline`, `member-permissions-characterization`, `access-matrix.*`, `member-sql-parity`, `catalog-usage` | Confirmar en verde; solo se extienden con M9 |
| Registro de jobs | `lib/jobs/bootstrap-characterization.test.ts` (26 tipos exactos) | Confirmar; se extiende con los 4 tipos nuevos (`finance_daily`, `comment_backfill`, `comment_backfill_workspace`, `commissions_payment`) |
| Orden del menú | `lib/nav/items.test.ts`, `menu-by-role.characterization.test.ts` | Confirmar; "Finanzas" se suma al final del grupo `ventas` y el resto del orden no cambia |
| Huellas SQL | Solo 3 funciones tenían huella fijada en algún script | Guardar las 8 (tabla de §1) en PROGRESS y compararlas en `verify-organic-attribution`/`verify-commissions` y al final |

## 6. Plan por bloque

### MP — Métodos de pago (F1–F6)
- **Orden:** caracterización de cobro con fee → F1 (00224) → F2 → F3 → F4 → F5 → F6.
- **F1/00224:** además de lo del plano, el trigger de copia desde el snapshot (diferencia 2). CHECK de forma de `payment_methods`: `jsonb_typeof = 'array'` (la forma completa la valida Zod).
- **F2 archivos:** nuevos `lib/sales/payment-methods-config.ts` (+test), `lib/sales/fee-preview.ts`, `lib/sales/enabled-methods-boundary.test.ts` (excluye `*.test.ts`, `lib/types/database.ts`, comentarios y `scripts/`). Modificados: `payment-methods.ts` (catálogo de arranque + funciones sobre lista recibida), `fees.ts` (`computeProviderFee` con tope, `feeBreakdown` en centavos, snapshot desde el método de la config), `payments-rules.ts`, `payments-core.ts`, `create.ts`, y los lectores: `wizard/load.ts`, `flow-engine/nodes/sales-actions.ts`, `actions/payments.ts`, `actions/sales.ts`, `actions/sales-settings.ts`, `ventas/pagos/page.tsx`, `settings/page.tsx`, `settings-view.tsx`, `components/settings/sales-settings.tsx`, `payments-list.ts/tsx`, `SalesTriggerPanel.tsx`, `automation/triggers.ts`, `automation/variables.ts`, `step3-financing.tsx`, `payment-dialogs.tsx`.
- **F3:** `planMarkPaid` y `buildPaymentRows` escriben %, fijo y total; `REVERT_CLEARED_FIELDS` suma los dos nuevos (si no, el CHECK rechazaría revertir); reembolso deja los tres en null.
- **F4:** `updatePaymentMethods` (`sales.settings`, Zod, `validateMethodsUpdate`, servicio sobre solo esa columna, `audit_log payment_methods.updated`) en `lib/actions/sales-settings.ts`; tabla + modal con vista previa en la sección "Ventas y cobranza" (reemplaza las casillas).
- **F5:** línea "Cobrado · Fee (2,9 % + 0,30) · Neto" en `payment-table.ts`, `payments-list.tsx`, `sale-detail.tsx`. **F6** (nice-to-have): "Corregir comisión del procesador".
- **Pantallas:** Ajustes > General > Ventas; lista de Pagos; ficha de venta.
- **Verificación del "listo":** F1–F5 con criterios, `npx vitest run`, `verify-payment-methods`, `verify-sales`, `verify-rls --despues-de-00143` en 0, lint, build, 00224 aplicada y registrada.
- **Riesgos:** alto — 00224 cambia la regla que valida el método (0 pagos, sin datos en juego). Un lector olvidado ofrece métodos viejos (test de frontera). `verify-sales` antes y después.

### G1 — Gastos, categorías y proveedores (GF1–GF14)
- **Orden:** 00225 → 00226 → 00227 (aplicadas antes del código) → GF2 permisos/menú → GF3/GF4 categorías en Ajustes → GF5 proveedores → GF6 estados → GF7 alta/edición → GF8 comprobante → GF9 pagar/revertir → GF10 anular/duplicar → GF11 handler `finance_daily` (solo paso "vencer") → GF12 lista → GF13 CSV → GF14 historial.
- **Cambios de §6.2 aplicados:** sin tablas de categorías ni settings (jsonb en `workspaces`, 12 precargadas con `commissions`), `category_key` + trigger `EX001`, `vendors.user_id`, origen `commission_payout` y su CHECK, `expenses_guard` ampliado, ruta de configuración en Ajustes, `audit_log_select_finance`.
- **Permisos (los 5 pasos de `docs/roles.md`):** módulo `finance`, claves `expenses.view/manage` y `commissions.view/manage` (las de comisiones se agregan acá para evitar dos pasadas por el catálogo; su uso real llega en CM; `catalog-usage` se mantiene verde con el uso en el menú y en las páginas), guards de página/acción/menú, ítem "Finanzas" (`permissions: ["expenses.view","commissions.view"]`), `lib/finance/tabs.ts` pura. `commissions` en `SCOPED_MODULES` y M9 se hacen en CM1 junto a su migración (así `member-sql-parity` nunca queda a medias).
- **Archivos nuevos:** `lib/finance/*` (format, dates, expense-status, expense-schema, expense-filters, expense-list, categories, vendors, receipts, expenses-csv, tabs), `lib/actions/finance-*.ts`, `lib/csv/write.ts`, `lib/jobs/handlers/finance-daily.ts`, `app/(dashboard)/dashboard/finanzas/{layout,page,gastos,proveedores}/…`, `app/api/v1/expenses/export/route.ts`, `components/finance/*`, `scripts/verify-expenses.mjs`, secciones nuevas en `lib/settings/general-sections.ts` y la vista de Ajustes.
- **Modificados:** `permissions.ts`, `lib/nav/items.ts`, `components/sidebar.tsx`, `page-actions.ts`, `lib/settings/tabs.ts`, `general-sections.ts`, `settings-view.tsx`, `lib/publishing/bootstrap.ts`, `lib/notifications/types.ts`, `lib/types/database.ts` (`AuditEntityType`), `scripts/verify-permissions-matrix.mjs`, tests de menú/permisos (diferencias 8–10).
- **Pantallas:** Finanzas > Gastos (lista, ficha, formulario), Proveedores, Ajustes > General > Finanzas (categorías).
- **Verificación del "listo":** GF1–GF14, vitest, `verify-expenses`, `verify-rls`, `verify-roles`, `verify-audit-visibility --despues-de-00168` (mismo conteo de `audit_log` por tipo antes y después), lint, build, 00225–00227 aplicadas.
- **Riesgos:** la política nueva de `audit_log` (caracterización antes/después); el CHECK de `origin` de gastos con `commission_payout` desde el día 1; tests de menú.

### G2 — Recurrentes y automáticos (GF15–GF22)
- **Orden:** 00228 y 00229 → GF15 motor de recurrencia (puro, con `TZ` distintos en el test) → GF16 plantillas → GF17 generación idempotente → GF19 configuración (Ajustes > Finanzas; `processor_fees` con las claves de `payment_methods`) → GF20 comisiones de procesador → GF21 pauta Meta → GF22 diferencia y ajuste → GF18 faltantes (nice-to-have).
- **Archivos:** `lib/finance/{recurrence,recurring,generate-recurring,settings,auto-expenses}.ts`, `lib/actions/finance-{recurring,settings}.ts`, `app/…/finanzas/recurrentes`, handler `finance_daily` ampliado a los 5 pasos, `verify-expenses` (concurrencia real, paridad de los 8 casos).
- **00233** (`cron.schedule`) se escribe y se ensaya con `BEGIN … ROLLBACK`, **no se aplica**; "Calcular ahora" encola el trabajo a mano para probar.
- **Riesgos:** índices únicos de idempotencia (probados con concurrencia real); `bootstrap-characterization` se extiende con `finance_daily`; la comisión de procesador depende de que MP escriba bien `provider_fee_amount`.

### G3 — Panel de Finanzas (GF23–GF28)
- **Orden:** GF23 métricas puras (céntimos) → GF24 loader con agregados → GF25 tarjetas → GF26 categorías/grupos/top proveedores → GF27 tendencia (+CAC) → GF28 por pagar (nice-to-have).
- **Archivos:** `lib/finance/{metrics,dashboard-load,dashboard-view}.ts`, `components/finance/*` (incluye `category-bars.tsx`), `app/…/finanzas/page.tsx`. Gráficos con `charts.tsx` (`DualAxisChart` apilada + línea); test estático de que `components/finance/**` no importa `recharts`.
- **Riesgos:** ningún dato de ventas individual viaja al navegador (test sobre la forma del loader); reembolsos como fila `paid` negativa (neto = suma de `paid`).

### AO1 — Toques de contenido (F30–F37)
- **Orden:** huellas guardadas y `verify-attribution/ads-attribution/crm/forms` en verde → 00230 (aplicada antes del código) → F30 código/canal (`channel.ts` + `channel.cases.json`) → F31 opción de comentarios + sección "Atribución" en Ajustes → F32 vínculo retroactivo (`link-to-contact.ts` extraído, handler `comment-backfill`, 00234 solo ensayada) → F33 historia→pieza → F34 variables `content.*` → F35 herencia de pieza en DMs (`inherit.ts`, ambos receptores) → F36 `messageOrigin` → F37 canal visible.
- **Cuidado:** los dos triggers nuevos de `contact_touches` van con `EXCEPTION WHEN OTHERS` (probado forzando el error); el de canal respeta un `channel` puesto en el INSERT; `link_click` solo se suma al CHECK y a `taxonomy.ts` (con etiqueta); la herencia va después de guardar el mensaje y dentro del `try` del toque (no demora al agente); el orden "guardar mensaje → toque → agente" de los receptores no cambia (`e2e-zernio.test.ts` sigue verde).
- **Archivos principales:** `lib/attribution/{channel,settings,inherit}.ts`, `lib/comments/{link-to-contact,attribution}.ts`, `lib/jobs/handlers/comment-backfill.ts`, `lib/contacts/{touch-inbound,taxonomy,attribution-view}.ts`, `lib/messages/origin-context.ts`, `lib/comment-processor.ts`, `lib/flow-engine/{send,engine}.ts`, `lib/actions/attribution-settings.ts`, `scripts/verify-organic-attribution.mjs`.
- **Verificación del "listo":** F30–F37, vitest, los 6 `verify-*` de atribución en 0, **huella de `record_contact_touch` igual**, `count(*) from contact_touches where channel is null` = 0, 00230 aplicada, 00234 ensayada.
- **Riesgos:** alto — 00230 toca la tabla donde escribe todo lo entrante; F33 (diferencia 16) puede quedar sin efecto real hasta confirmar en vivo.

### AO2 — Códigos y links (F38–F42)
- **Orden:** ampliar la caracterización de "Enviar mensaje" → F38 código en el drawer de la pieza → F39 interruptor y `buildAttributedUrl` (`link-params.ts`) → F40 `/l/[token]` (`tracked-link.ts`, `bots.ts`, `app/l/[token]/route.ts`) → F41 test de punta a punta con `submit_form_response` real → F42 generador (nice-to-have).
- **Seguridad:** destino solo del token firmado; nunca 500; previsualizadores no cuentan; no se loguea el token; `checkLimit` 120/min por IP; secreto en Vault con `readSecret` y cliente de servicio; `l` en `RESERVED_ROUTES` y `docs/sitio.md`; `tracked-link.ts` en `vault-boundary.test.ts` (con el filtro ampliado).
- **Pantalla:** bloque plegable "Atribución de links" en `SendMessagePanel.tsx` con ejemplo en vivo; código en el drawer.
- **Listo:** F38–F41, vitest, `verify-organic-attribution`, `verify-forms`, `vault-boundary` en verde. Con el interruptor apagado, lo enviado es idéntico (test).

### AO3 — Responsable, lectura y venta (F43–F49)
- **Orden:** F43 responsable (`content-owner.ts` + `.cases.json`, `commission_content_owner` se crea en 00231 y su paridad se prueba allí; filtro por responsable; selector en publicaciones sin pieza) → F36 ya hecho → F44 chip "Vino de…" (`originChipsFor`) → F45 línea de tiempo (`touch-timeline.ts`) → F46 sugerencia (`suggestSaleTouch`) → F47 selector de canal (`manual-channel.ts`, `recordTouch` + `create_sale` en modo `touch`) → F49 "De dónde vino" (`sales/attribution-view.ts`, columna y filtros en la lista) → F48 (nice-to-have).
- **Riesgos:** F47 cambia el significado de la atribución manual (hoy sin toque); la edición de la venta tiene su propio camino (diferencia 14); doble clic ⇒ un solo toque (`dedupeKey` por venta/clave de idempotencia).

### CM1 — Motor de comisiones (F50–F56)
- **Orden:** caracterización de permisos del Member → 00231 (incluye `member_permission_keys()` +`commissions.view`, `SCOPED_MODULES`, los ~12 lugares de la diferencia 9, M9 en tests) → 00232 → F51 `commission_facts` → F52 reglas (`rules.ts` + `rules.cases.json` ≥40) → F53 generar al cobrar (handler `commissions-payment`; trigger 00235 solo ensayado) → F54 reversión → F55 test de venta cancelada → F56 estado derivado.
- **Listo:** F50–F56, vitest (paridades en 0 diferencias), `verify-commissions`, `verify-sales`, `verify-payment-methods`, `verify-rls`, `verify-roles`, `verify-permissions-matrix` con las 5 tablas nuevas, `member-sql-parity` y `catalog-usage` en verde, 00231/00232 aplicadas, 00235 ensayada.
- **Riesgos:** alto — permisos del Member (solo `commissions.view` con alcance `own`, nada más); `can_see_commission` con `COALESCE`; el trigger de rol `CM001`; unicidad por pago y rol bajo concurrencia.

### CM2 — Reglas y pantalla (F57–F62)
- **Orden:** F57 editor de reglas y roles (`describe.ts`, `rule-schema.ts`, `shadow.ts`, `roles.ts`; arrastre HTML5 + teclado `Alt+↑/↓`) → F58 "Probar con una venta" (sin escribir nada) → F59 lista (filtros en URL, totales por estado, agrupar) → F60 selección en bulk y `create_commission_payout` → F61 drawer `?commission=` → F62 comisiones en la venta y en el gasto.
- **Seguridad:** el estado del gasto llega por el cliente de servicio, solo con 4 campos; un Member con alcance `own` ve contacto y producto de su comisión (decisión D-R4).

### CM3 — Personas y cierre (F63–F67)
- F63 "Mis comisiones" (tabs de Finanzas con solo `commissions.view own`), F64 ajuste manual y sugerencia por reembolso, F66 avisos (`commission_generated` con `createNotificationOnce` por persona, `commission_payout_paid`, `commission_review_needed`), F67 CSV + historial (`audit_log_select_commissions`), F65 recalcular pendientes (nice-to-have).
- **Listo:** F63, F64, F66, F67, `verify-commissions`, `verify-audit-visibility --despues-de-00168`.

## 7. Cierre de la corrida

1. Suite completa: `npx vitest run`, `npm run build`, `npx tsc --noEmit`, lint, y todos los `verify-*` del punto de partida más los 4 nuevos, **de a uno con el candado y la salida mostrada**.
2. Las 8 huellas comparadas con §1: iguales. `content_posts.assigned_to` y su trigger sin cambios. `send-message` con el interruptor apagado, idéntico.
3. Docs de §9: `docs/finanzas.md`, `docs/comisiones.md`, y actualizar `atribucion.md`, `ventas.md`, `flow-registry.md`, `sitio.md`, `roles.md` (módulos con alcance), `PROGRESS/PENDIENTE-extra-i.md`.
4. `CLAUDE.md`: secciones "Métodos de pago", "Gastos y Finanzas", "Atribución orgánica" y "Comisiones" (cada una con "Lo que no se puede romper", migraciones y cuáles quedan para después del merge), M9 en "Equipo, roles y permisos", y corregir la numeración vieja (próxima libre 00236).
5. `gh pr create` de `feat/extra-i` a `main`, **sin mergear**, con resumen de PROGRESS y PENDIENTE y la sección **"Después del merge"**: aplicar 00233, 00234, 00235 en ese orden y correr `verify-expenses --despues-de-00233`, `verify-organic-attribution --despues-de-00234`, `verify-commissions --despues-de-00235`, `verify-contacts-single-entry`, más la consulta de `scheduled_jobs` del barrido de comentarios.

## 8. Primeras tareas apenas aprobés (y después FRENO)

1. Crear `docs/PROGRESS-extra-i.md` con: este plan tal cual, los 10 bloques con sus F (F1–F67 y GF1–GF28) como checklist, "Punto de partida" (§1, completado con build y `verify-*` al medirlos) y "Migraciones" (§3).
2. Crear `docs/PENDIENTE-extra-i.md` (qué quedó / por qué / qué se decidió) ya con la entrada de 00233–00235 "se aplican después del merge", más los puntos a confirmar con Wendy: permiso del selector de responsable en Social (diferencia 26), F33 historias (diferencia 16) y la Whop en 0 % hasta que cargue el real.
3. Copiar el `.env` y enlazar `supabase/.temp` (ambos ignorados por git; no se imprimen), medir build y `verify-*`.
4. Commit `docs: plan del Extra I` (con ruta explícita) y `git push origin feat/extra-i`.
5. **Frenar y esperar el `/goal`.** No se empieza MP hasta entonces.

## 9. Cómo se verifica el trabajo terminado

Lo de §7, más recorrido visual y el flujo 7.1 del plano de punta a punta con datos de prueba (comentario → DM con link → clic → agenda → venta con sugerencia → cobro → comisiones → liquidación → gasto pagado → "Pagada"), y un usuario Member que ve solo "Mis comisiones".

---

# Checklist por bloque

Marcar `[x]` al cumplir los criterios de la F. Las nice-to-have pueden quedar en `[~]` con la decisión en `PENDIENTE-extra-i.md`. Los bloques se cierran con commit `feat: extra-i - bloque X (nombre)` y `git push origin feat/extra-i`.

## Antes de MP
- [x] Test de caracterización del cobro con fee distinto de 0 (`lib/sales/payments-fee-characterization.test.ts`)

## MP — Métodos de pago
- [x] F1 Migración 00224 (métodos del negocio, % y fijo en el pago, trigger que valida el método)
- [x] F2 Módulo de métodos de pago (código) + test de frontera de `enabled_payment_methods`
- [x] F3 El pago congela %, fijo y total al cobrar (y la reversión los limpia)
- [x] F4 Pantalla de métodos de pago (Ajustes > General > Ventas)
- [x] F5 Neto y fee en la pantalla del pago
- [x] F6 Corregir el fee de un pago cobrado (nice-to-have)
- [x] Bloque MP listo (vitest, verify-payment-methods, verify-sales, verify-rls, lint, build, 00224 aplicada y registrada)

## G1 — Gastos, categorías y proveedores
- [x] GF1 Tablas, RLS y `verify-expenses.mjs` (00225)
- [x] GF2 Permisos y navegación (módulo `finance`, 4 claves, ítem Finanzas, `lib/finance/tabs.ts`)
- [x] GF3 Valores por defecto (categorías precargadas y configuración en jsonb)
- [x] GF4 Categorías (Ajustes > General > Finanzas)
- [x] GF5 Proveedores
- [x] GF6 Estados y transiciones (función pura)
- [x] GF7 Alta y edición de un gasto
- [x] GF8 Comprobante (00226)
- [x] GF9 Marcar pagado y revertir
- [x] GF10 Anular y duplicar
- [x] GF11 Vencimiento diario y handler `finance_daily`
- [x] GF12 Lista de gastos
- [x] GF13 Exportar CSV
- [x] GF14 Historial de Finanzas (00227)
- [x] Bloque G1 listo

## G2 — Recurrentes y automáticos
- [x] GF15 Motor de recurrencia (función pura)
- [x] GF16 Plantillas recurrentes
- [x] GF17 Generación diaria idempotente (00228)
- [~] GF18 Generar faltantes con vista previa (nice-to-have)
- [x] GF19 Configuración de los gastos automáticos
- [x] GF20 Comisiones de procesador (00229)
- [x] GF21 Pauta de Meta
- [x] GF22 Cambio después de pagado y ajuste
- [x] 00233 escrita y ensayada con `BEGIN … ROLLBACK` (NO se aplica)
- [x] Bloque G2 listo

## G3 — Panel de Finanzas
- [x] GF23 Métricas puras en centavos
- [x] GF24 Lectura de datos del panel
- [x] GF25 Resumen: ingresos, gastos, resultado y margen
- [x] GF26 Por categoría, por grupo y top proveedores
- [x] GF27 Tendencia de 6 meses y CAC
- [x] GF28 Por pagar (nice-to-have)
- [x] Bloque G3 listo

## AO1 — Toques de contenido
- [x] F30 Migración 00230 (columnas, canal y triggers) + `touch_channel` ↔ `channel.ts`
- [ ] F31 Opción "Crear contactos desde comentarios" + sección Atribución en Ajustes
- [ ] F32 Vínculo retroactivo de comentarios (job; 00234 solo ensayada)
- [ ] F33 Respuesta a historia → pieza
- [ ] F34 Variables de pieza en los flujos de contenido
- [ ] F35 Herencia de pieza en los DMs que responden a una automatización
- [ ] F36 Atribución por mensaje visible en los datos
- [ ] F37 Clasificación visible del canal
- [ ] Bloque AO1 listo (huella de `record_contact_touch` igual)

## AO2 — Códigos y links
- [ ] Test de caracterización de "Enviar mensaje" ampliado (antes de tocarlo)
- [ ] F38 Código de la pieza en Contenido
- [ ] F39 Interruptor "Agregar parámetros de atribución" en los flujos
- [ ] F40 Registrar el clic (`/l/[token]`)
- [ ] F41 Atribución de las visitas con UTMs de pieza (prueba de punta a punta)
- [ ] F42 Generador de links (nice-to-have)
- [ ] Bloque AO2 listo

## AO3 — Responsable, lectura y venta
- [ ] F43 Responsable de la pieza (filtro, publicaciones sin pieza, `commission_content_owner`)
- [ ] F44 Chip "Vino de…" en la bandeja
- [ ] F45 Línea de tiempo de toques en la ficha
- [ ] F46 Sugerencia de toque al cargar la venta
- [ ] F47 Selector de canal al cargar a mano
- [~] F48 Contenido que vende (nice-to-have; anotado en PENDIENTE)
- [ ] F49 La venta muestra su atribución
- [ ] Bloque AO3 listo

## CM1 — Motor de comisiones
- [ ] F50 Migración 00231 (tablas, roles, RLS, permisos del Member: cambio aprobado M9)
- [ ] F51 Los hechos de un pago (`commission_facts`)
- [ ] F52 Elegir la regla (gemelas SQL ↔ TS, ≥ 40 casos)
- [ ] F53 Generar comisiones al cobrar (00235 solo ensayada)
- [ ] F54 Reversión de un cobro
- [ ] F55 Venta cancelada (no regresión)
- [ ] F56 Estado derivado de una comisión
- [ ] 00232 aplicada
- [ ] Bloque CM1 listo

## CM2 — Reglas y pantalla
- [ ] F57 Editor de roles y reglas
- [ ] F58 Probar con una venta
- [ ] F59 Finanzas > Comisiones (lista)
- [ ] F60 Selección en bulk y Generar gasto
- [ ] F61 Ficha de la comisión (drawer) y acciones
- [ ] F62 Comisiones en la venta y en el gasto
- [ ] Bloque CM2 listo

## CM3 — Personas y cierre
- [ ] F63 Mis comisiones
- [ ] F64 Ajuste manual
- [ ] F65 Recalcular pendientes (nice-to-have)
- [ ] F66 Avisos
- [ ] F67 CSV e historial
- [ ] Bloque CM3 listo

## Cierre
- [ ] Suite completa + build + tsc + lint + todos los `verify-*` (de a uno, con candado)
- [ ] Las 8 huellas iguales al punto de partida
- [ ] Docs de §9 (`finanzas.md`, `comisiones.md`, `atribucion.md`, `ventas.md`, `flow-registry.md`, `sitio.md`, `roles.md`)
- [ ] `CLAUDE.md` con las 4 secciones nuevas y el cambio aprobado M9
- [ ] Revisión visual (1440 y 390 px, claro y oscuro) hecha o anotada
- [ ] PR abierto de `feat/extra-i` a `main` con la sección "Después del merge" (sin mergear)

---

# Migraciones (plano → número real)

Primer número libre confirmado el 15/10/2026: **00224** (última registrada: `00223_content_post_assignee`). El número real coincide con el del plano.

| Plano | Real | Archivo | Qué | Quién la aplica | Estado |
|---|---|---|---|---|---|
| 00224 | 00224 | `00224_payment_methods.sql` | Métodos de pago del negocio, % y fijo en el pago, trigger de validación | Corrida (MP) | **aplicada y registrada (15/10/2026)** |
| 00225 | 00225 | `00225_finance_tables.sql` | `expenses`, `recurring_expenses`, `vendors`, `finance_settings`, triggers, RLS | Corrida (G1) | **aplicada y registrada (15/10/2026)** |
| 00226 | 00226 | `00226_expense_receipts_bucket.sql` | Bucket privado de comprobantes | Corrida (G1) | **aplicada y registrada (15/10/2026)** |
| 00227 | 00227 | `00227_audit_log_select_finance.sql` | Política adicional del historial de Finanzas | Corrida (G1) | **aplicada y registrada (15/10/2026)** |
| 00228 | 00228 | `00228_finance_daily.sql` | `mark_expenses_overdue`, `private.enqueue_finance_daily` (sin programar el cron) | Corrida (G2) | pendiente |
| 00229 | 00229 | `00229_upsert_auto_expense.sql` | Gastos automáticos | Corrida (G2) | pendiente |
| 00230 | 00230 | `00230_organic_attribution.sql` | Código de pieza, canal del toque, triggers, ajustes de atribución | Corrida (AO1) | pendiente |
| 00231 | 00231 | `00231_commissions.sql` | Roles, reglas, comisiones, motor, liquidación, permisos del Member | Corrida (CM1) | pendiente |
| 00232 | 00232 | `00232_audit_log_select_commissions.sql` | Política adicional del historial de comisiones | Corrida (CM1) | pendiente |
| 00233 | 00233 | `00233_finance_daily_cron.sql` | `cron.schedule('finance-daily')` | **Wendy, después del merge** | NO aplicar |
| 00234 | 00234 | `00234_comment_backfill_trigger.sql` | Trigger en `contacts` + barrido inicial de comentarios | **Wendy, después del merge** | NO aplicar |
| 00235 | 00235 | `00235_commissions_payment_trigger.sql` | Trigger en `payments` que encola las comisiones | **Wendy, después del merge** | NO aplicar |

Los nombres de archivo son una propuesta; si cambian, se corrige esta tabla en el mismo commit.

---

# Punto de partida (medido el 15/10/2026)

- `npx vitest run`: 900 archivos, 11.407 tests, todo en verde.
- `npm run lint`: 0 errores, 36 avisos.
- `npm run build`: compila (sin diferencias en `public/embed/embed.js`).
- Huellas de las 8 funciones protegidas: ver la tabla de la sección 1 del plan.
- `verify-*` (28 scripts, de a uno con el candado, 15/10/2026): **25 en 0**. Fallan HOY, ya en `main`, y se anotan (no pueden empeorar):
  - `verify-attribution`: «todos los contactos reales tienen first_touch (819 de 878)» — depende de los datos reales de la base (59 contactos sin primer toque). Confirmado sobre una copia limpia de `main`.
  - `verify-tasks`: «las fechas de las dependientes ajenas se corrigieron (B al 14, C al 15)». Confirmado sobre una copia limpia de `main`.
  - `verify-publishing` falló en la primera pasada por una edición mía en curso (lib/ cambiaba mientras corría); sobre `main` limpio y sobre mi árbol después da 0.
  - `verify-webhook` no se corre: necesita la app local en marcha (`--target`).


---

# Registro de la corrida (decisiones y datos que no están en el plan)

- **15/10/2026 — worktree.** El worktree no traía `.env` ni `supabase/.temp`: se copió el `.env` y se enlazó `supabase/.temp` (ambos ignorados por git, nunca se imprimen). Los planos se leyeron del checkout principal.
- **MP.** `workspaces.payment_methods`, trigger `payments_validate_method` (PM001), trigger `payments_fee_spec_from_snapshot` (copia % y fijo del snapshot que manda `buildPaymentRows`, porque `create_sale` no se toca). `enabled_payment_methods` queda sin leerse (test de frontera). Los 5 métodos arrancan en comisión 0 (Whop incluido: Wendy carga el real).
- **G1.** `finance_settings` jsonb (12 categorías), `expenses`, `recurring_expenses`, `vendors`. Dos CHECK que dejaban pasar NULL (`workspaces_finance_settings_check` y `expenses_payout_vendor`) se corrigieron el mismo día con `COALESCE`, en el archivo y en la base (el `statements` registrado de la 00225 es el corregido).
- **Exportar CSV de gastos** lo habilita `expenses.view` (como pide el plano de Gastos), no `data.export`. Anotado en `docs/finanzas.md`.
- **Trabajo en paralelo.** La lógica pura (recurrencia, métricas, gastos automáticos, atribución, comisiones), con sus archivos de casos compartidos, y la UI de G1 se escribieron en paralelo con subagentes; la integración, las migraciones, los permisos y las verificaciones las hice yo.
- **Dudas del plano resueltas por el código:** la regla del vendedor del flujo 7.1 es **8 % del neto** (38,82 / 25,00 / 15,00); el «12 %» del enunciado era un ejemplo de frase (`alcance-v11.md` línea 230 dice 8 %).
- **G2.** 00228 y 00229 aplicadas y registradas; `verify-expenses` completo en 0 (incluye paridad de los 8+13 casos de `decide_auto_expense_action`, concurrencia de 8 recálculos y `enqueue_finance_daily` con reloj fijo). 00233 solo ensayada con `BEGIN … ROLLBACK` (no se aplica). GF18 (generar faltantes con vista previa) quedó sin hacer: el aviso de las fechas salteadas al reactivar cubre el caso común (ver PENDIENTE). Reactivar una plantilla reinicia el anclaje a hoy; editar solo reinicia si cambia la regla de fechas o la anticipación (`editResetsAnchor`).
- **G3.** El período por defecto del Resumen es «Este mes» (los demás dashboards usan 30 días). Pagos y ventas se leen con el cliente de servicio después de `expenses.view` y solo viajan agregados (test de forma). La zona es la del workspace, no la de quien mira.
- **AO1 (parcial).** 00230 aplicada y registrada (836 toques con canal: 832 organic, 4 direct); `verify-organic-attribution` en 0. `record_contact_touch` no escribe `channel`, así que el canal siempre sale del trigger (el selector de la venta lo logra con `medium`).
- **AO1 (cierre).** F30–F37 hechas. 00230 aplicada y registrada; 00234 escrita y ensayada con `BEGIN … ROLLBACK`, SIN aplicar. Verificaciones: `verify-organic-attribution`, `verify-crm`, `verify-forms`, `verify-contacts-single-entry` en 0; `verify-attribution` falla igual que en el punto de partida (821 de 880 contactos con first_touch: los mismos 59 sin primer toque); `verify-ads-attribution` dio 0 y una vez falló por tiempo (2,5 s) mientras corría todo el resto: repetido solo, 75 ms (cargas simultáneas, no el cambio). La huella de `record_contact_touch` y de las otras siete no cambió. F33 (historia → pieza) queda defensivo: ver PENDIENTE.
- **AO2/AO3/CM1.** AO2: `/l/[token]` con tope por IP, previsualizadores sin registrar y destino solo del token firmado; el nodo «Enviar mensaje» con el interruptor apagado queda idéntico (9 casos de caracterización escritos ANTES del cambio). AO3: responsable de una publicación sin pieza (`content.publish`), filtro «Responsable» en la lista de piezas, chip «Vino de…», línea de tiempo en `/dashboard/contacts/[id]/toques`, sugerencia de toque, «Cargar a mano» por canal (el canal sale del trigger según `medium` e ids; `record_contact_touch` no acepta `channel`) y «De dónde vino». CM1: 00231 y 00232 aplicadas y registradas (la 00231 se corrigió el mismo día: `commissions_guard` deja pasar al trigger que libera comisiones con una bandera de transacción `app.commissions_internal`; el SQL registrado es el corregido); 00235 escrita y ensayada, SIN aplicar. La paridad de los 113 casos de reglas y los 10 de responsable da 0 diferencias. `verify-commissions`, `verify-permissions-matrix` (con las dos tablas nuevas), `verify-rls`, `verify-roles`, `verify-audit-visibility`, `verify-workspace-isolation`, `verify-sales`, `verify-payment-methods`, `verify-crm` en 0. `verify-attribution` sigue con el mismo fallo de los datos reales (824 de 883, los mismos 59 contactos sin primer toque).
- **CM2/CM3.** Pantallas: `/dashboard/finanzas/comisiones` (lista con pastillas, filtros en la URL, agrupar, selección y «Generar gasto», ficha en `?commission=`, ajuste manual y por reembolso, CSV) y `/dashboard/finanzas/comisiones/reglas` (pestañas por rol, roles, reglas ordenables con arrastre y teclado, «Probar con una venta»). F65 (recalcular pendientes) quedó sin hacer (ver PENDIENTE). **Revisión visual (15/10/2026, navegador de la app con la sesión de Wendy):** Resumen, Gastos, Recurrentes, Proveedores, Comisiones y Reglas a 1440 px y a 390 px, y Ajustes (Finanzas y Atribución): sin scroll horizontal de la página y sin errores en la consola; las pantallas se vieron con la base vacía (sin gastos ni comisiones), así que las filas, los diálogos y el drag de reglas quedan para revisar con datos. `/l/<token inválido>` redirige sin error.

---

# Cierre de la corrida (15/10/2026)

- `npx vitest run`: 1.019 archivos, 13.135 tests, todo en verde. `npx tsc --noEmit` limpio. `npm run lint`: 0 errores, 36 avisos (los mismos del punto de partida). `npm run build` compila.
- **`verify-*` corridos de a uno con el candado** (salida completa en la conversación de la corrida): en 0 `payment-methods`, `expenses`, `organic-attribution`, `commissions`, `sales`, `ads-attribution`, `crm`, `contacts-single-entry`, `rls --despues-de-00143`, `roles --despues-de-00136 --despues-de-00208 --despues-de-00211 --despues-de-00212`, `audit-visibility --despues-de-00168`, `permissions-matrix`, `workspace-isolation --despues-de-00143`, `content`, `inbox-filters`, `dashboards`, `publishing`, `scheduling`, `booking-concurrency`, `eod`, `contact-merge`, `calls`, `chat-media`, `csv-import`, `enrichment`, `knowledge`, `message-persistence`, `optout`, `inbound-webhooks` y `forms`.
  - **Fallan igual que en el punto de partida** (datos reales de la base, no del cambio): `attribution` (824 de 884 contactos con first_touch: los mismos 59 sin primer toque) y `tasks` (una fecha de dependientes).
  - **Intermitentes por una carrera con el servidor de producción** (corridos otra vez, en 0): `verify-forms` falla a veces en «el job genera el PDF de la firma» (`already`: el trabajador real de la cola se lleva el `contract_pdf` antes que el script) y en las respuestas simultáneas; `verify-ads-attribution` falló dos veces por el tiempo de `EXPLAIN ANALYZE` (1,2 s y 2,5 s con la base ocupada; solo, 75 ms); `verify-sales` falló una vez de 4 y las otras tres dio 0.
- Las huellas de las ocho funciones protegidas (`scripts/protected-functions.mjs`) se comparan dentro de `verify-expenses`, `verify-organic-attribution` y `verify-commissions`: iguales.
- `content_posts.assigned_to` y su trigger no se tocaron; «Enviar mensaje» con el interruptor apagado es idéntico (9 casos de caracterización escritos antes del cambio).
- Migraciones: **00224 a 00232 aplicadas y registradas**; **00233, 00234 y 00235 escritas y ensayadas con `BEGIN … ROLLBACK`, sin aplicar**. `ALL_MIGRATIONS.sql` regenerado (232).
