# PENDIENTE — Servicios v12, Corrida A1

## ⛔ Corrida frenada en S02 (8/11/2026) — necesita una decisión

**Qué pasó.** La `00331` (S02) agrega la clave foránea `form_submissions.service_id → app_servicio.services` (y la de `contract_signatures.service_id`), como pide el §8 del plano. Al correr `verify-forms` justo después, el caso «con un link válido la respuesta va al contacto del link…» se cortó: el link firmado de un formulario puede llevar un `service_id` (existe desde la 00150, F20), y si ese servicio no existe la base rechaza el guardado con `23503` y **la respuesta se pierde** (`save_failed`). Antes de la 00331 se guardaba igual. Hoy no existe ningún servicio, así que cualquier link firmado con un `service_id` perdería respuestas.

**Qué se hizo.** Se volvió atrás la 00331 con su cabecera (tablas, claves, columnas y registro: los cuatro conteos en 0) y se comprobó que la base quedó como antes: `verify-forms` otra vez en 0 y `verify-servicios-migracion --s S01` verde. **La 00330 (S01) queda aplicada**: no cambia nada con el módulo apagado (nace apagado en todos los negocios) y está verificada. **El esquema `app_servicio` queda expuesto en la API** (solo tiene `services`, vacía y de solo lectura con RLS). Para quitarlo: `node scripts/servicios-api-schema.mjs --restaurar "public,graphql_public"`.

**Qué recomiendo.** No poner clave foránea en esas dos columnas: dejarlas como están (un `uuid` suelto, como desde la 00150) y que el módulo valide en su trigger (`submission_hook` ya ignora un servicio que no es de ese contacto o de ese negocio). Así:
- un formulario nunca pierde una respuesta por el módulo (la regla «lo automático nunca tumba lo que lo origina»);
- `verify-forms` no cambia ni una línea;
- los servicios no se borran nunca (solo se cancelan), así que no quedan referencias colgadas.

La otra salida, descartar el `service_id` que no existe como hace la 00164 con el `sale_id`, cambia lo que hoy guarda un formulario y obliga a tocar un caso de `verify-forms`. Por eso no la recomiendo.

**Para retomar:** con la decisión, sacar las dos claves foráneas de la `00331` (y de su cabecera y de `verify-servicios-migracion.spec.mjs`), volver a ensayarla, aplicarla y seguir con `verify-forms`, después la 00332.

Formato: **qué quedó · por qué · qué se decidió**. Lo que encontró la exploración del principio y la regla que se aplicó (el plano pide anotarlo acá) va en la primera sección.

## Lo que encontró la exploración (regla aplicada)

- **`submit_form_response` guarda el `meta` sin filtrar** (00204). · El plano pedía mirarlo. · Rama A de F17: el servidor pone el paso firmado en `meta.service_item_id` y un `BEFORE INSERT` lo valida y lo copia a `service_item_id`.
- **`get_public_form` descarta el EOD con `f.type <> 'eod'`** (00243) y `loadPublishedForm` con `isPublicFormType`. · Regla de F52. · No se reescribe; los tipos `terms`, `quiz` y `activity` se rechazan en el servidor de SSA (la lista de no públicos y la página).
- **Las reuniones guardan las UTM** (`bookings.utm jsonb`). · Regla de F18. · Se respeta `utm.svc_item` solo si el contacto es el del servicio.
- **`bookings` no tiene el estado `attended`.** · F18 lo nombra. · "Asistió" = la reunión pasa a `status_group = 'outcome'` (el mismo criterio de las métricas de anuncios, 00195).
- **`lib/assignment` no tiene gemela SQL.** · Regla de F96. · `svc_pick_owner` implementa en SQL el reparto y las condiciones, con casos compartidos con la gemela TS que reusa `lib/assignment`.
- **`sales.product_variant_id` es `NOT NULL`.** · Regla de F6. · La creación automática usa siempre esa variante; la rama "venta sin variante" queda programada pero no se dispara.
- **No existe `platform.set_module`.** · Regla de F97. · Se crea `app_servicio.set_module_enabled(workspace_id, enabled)` con `EXECUTE` solo para `service_role`.
- **`registerDesignVariables` y `onDesignGenerated` existen** (`lib/designer/extensions.ts`). · Regla de CE. · Se usan sin tocar el Diseñador. El aviso sale cuando el render queda listo.
- **`ai_threads` existe** y su CHECK ya admite el canal `portal` y `subject_type = 'product'`. · Regla de S15. · S15 suma solo la política de lectura del canal.
- **Reglas de comisión:** la tabla es `commission_rules`; los roles viven en `workspaces.commission_settings`; `commissions.user_id` acepta NULL y no hay `contact_id`. · Regla de F75. · S13 suma `commissions.contact_id` con un CHECK "una persona o un contacto, no los dos".
- **El `ref` de la URL** no se guarda en una columna de atribución del toque: solo sobrevive en `contact_touches.entry_url` (y en `raw.utm` para la Agenda). · Regla de F72. · El trigger lo busca en `entry_url`, después en `raw->'utm'` y después en `landing_page`.
- **Rutas de Ajustes › Productos:** `/dashboard/settings/productos/[id]`. · Regla de F114. · Se respeta el prefijo y el nombre del parámetro: la variante va en `/productos/[id]/variantes/[variantId]`.

## Diferencias con el plano

- **"Precio y cobro" sin versiones, Whop, "Crear ventas solas" ni link de pago.** · Nada de eso existe hoy: cada variante tiene un solo precio y su historial va a `audit_log`. · La pestaña es la de Precio e Historial de hoy, movida sin cambios. Lo que no existe no se construye.
- **"Recalcular pendientes" de comisiones no existe.** · F107 lo nombra. · Igual se suma `commissions.edited_manually`, y la generación y la reversión nunca pisan una comisión editada.
- **"Referido" de Ventas** (`contacts.referred_by_*`, regla "Referido" de la 00161). · Es parecido a "afiliado" y el plano no lo nombra. · Decisión de Wendy (8/11): **conviven sin tocarse**. Unificarlos queda para más adelante.
- **`rules.cases.json` nombra `public.commission_evaluate`, que no existe.** · Es un comentario viejo de Extra I. · Los casos nuevos corren contra `commission_payee` y `generate_commissions_for_payment`.

## Decisiones de la construcción (SV1 y SV2)

- **Claves foráneas de `services` a contactos, productos y variantes con `NO ACTION`, no `RESTRICT`.** · `RESTRICT` corta el borrado en cascada de un negocio entero (se borra todo en el mismo comando y `RESTRICT` se mira antes). · Con `NO ACTION` se mira al final del comando: borrar un negocio sigue andando y borrar suelto un contacto con servicios sigue rechazándose.
- **La purga de 30 días no borra un contacto con servicios.** · `purge_soft_deleted` borraría el contacto y chocaría con la clave foránea (la purga entera fallaría). · El trigger `trg_app_servicio_keep_contacts` (BEFORE DELETE) devuelve NULL para ese contacto, solo cuando el borrado no viene de una cascada (`pg_trigger_depth() > 1`). Queda borrado de forma lógica, como estaba.
- **Lo que hace el cliente desde el portal queda en `audit_log` como `system`, con la etiqueta «cliente».** · `audit_log.actor_type` admite `user | agent | system` (00144) y agregar un valor sería reescribir un CHECK de BAIOS. · `actor_type = 'system'` + `actor_label = 'cliente'`.
- **`portal_admin_save_settings` recibe el negocio como parámetro** (`p_workspace_id`). · Es `SECURITY DEFINER` y el negocio no se puede sacar de la sesión dentro de la base. · Lo valida con `has_permission(p_workspace_id, ...)`: alguien de otro negocio recibe `SV004`.
- **«Copiar de otra variante» desde otro producto marca los pasos que apuntan a cosas del otro producto como «(Requiere atención)».** · Un formulario o un evento de otro producto puede no tener sentido. · Se copia igual y se marca para revisar, en vez de descartarlo.
- **Las condiciones de la asignación (F96) ven solo la atribución canónica** (`contacts.attribution`) y los datos del contacto. · `lib/assignment` arma su contexto en TypeScript con más datos. · La gemela SQL usa los mismos casos (`owner-pick.cases.json`); un dato que la base no tiene se toma como vacío (no se cumple).
- **La zona horaria del cliente es `contacts.timezone`** hasta que el portal (AC) guarde la de la cuenta. · Si el contacto no tiene, la del negocio.
- **Los paneles de las acciones de Servicios en Automatizaciones piden la clave del paso o de la fase como texto.** · Elegirlos de una lista necesita saber de qué variante es el servicio, y una acción puede valer para varias. · Mejora para después: un selector con los caminos de los productos del negocio.
- **«Invitar al portal ahora» en la importación de servicios** queda para cuando exista la invitación (bloque AC).
- **El editor de automatizaciones solo ofrece los disparadores y pasos de Servicios con el módulo prendido** (`FlowModulesProvider`). · Con el módulo apagado el editor tiene que ser el de siempre. · Una automatización que ya tiene uno lo sigue mostrando y se puede editar.
- **Los 26 disparadores se registran todos en SV2**, también los que recién emiten bloques posteriores (`certificate_issued`, los del programa y las evaluaciones). · El CHECK de `triggers.type` se amplía una sola vez (00336). · Un disparador que todavía no emite nada no corre nunca: no cambia nada.

## Pasos manuales de Wendy

- **Apagar "Allow new users to sign up"** en Supabase › Authentication. `verify-auth-settings` lo informa.
