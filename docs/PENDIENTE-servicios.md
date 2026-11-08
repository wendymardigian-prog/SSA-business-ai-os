# PENDIENTE — Servicios v12, Corrida A1

## Corrida frenada en S02 (8/11/2026) — resuelto

**Qué pasó.** La `00331` (S02) agrega la clave foránea `form_submissions.service_id → app_servicio.services` (y la de `contract_signatures.service_id`), como pide el §8 del plano. Al correr `verify-forms` justo después, el caso «con un link válido la respuesta va al contacto del link…» se cortó: el link firmado de un formulario puede llevar un `service_id` (existe desde la 00150, F20), y si ese servicio no existe la base rechaza el guardado con `23503` y **la respuesta se pierde** (`save_failed`). Antes de la 00331 se guardaba igual. Hoy no existe ningún servicio, así que cualquier link firmado con un `service_id` perdería respuestas.

**Qué se hizo.** Se volvió atrás la 00331 con su cabecera (tablas, claves, columnas y registro: los cuatro conteos en 0) y se comprobó que la base quedó como antes: `verify-forms` otra vez en 0 y `verify-servicios-migracion --s S01` verde. **La 00330 (S01) queda aplicada**: no cambia nada con el módulo apagado (nace apagado en todos los negocios) y está verificada. **El esquema `app_servicio` queda expuesto en la API** (solo tiene `services`, vacía y de solo lectura con RLS). Para quitarlo: `node scripts/servicios-api-schema.mjs --restaurar "public,graphql_public"`.

**Qué recomiendo.** No poner clave foránea en esas dos columnas: dejarlas como están (un `uuid` suelto, como desde la 00150) y que el módulo valide en su trigger (`submission_hook` ya ignora un servicio que no es de ese contacto o de ese negocio). Así:
- un formulario nunca pierde una respuesta por el módulo (la regla «lo automático nunca tumba lo que lo origina»);
- `verify-forms` no cambia ni una línea;
- los servicios no se borran nunca (solo se cancelan), así que no quedan referencias colgadas.

La otra salida, descartar el `service_id` que no existe como hace la 00164 con el `sale_id`, cambia lo que hoy guarda un formulario y obliga a tocar un caso de `verify-forms`. Por eso no la recomiendo.

**Decisión de Wendy (8/11):** sin clave foránea en `form_submissions.service_id`, `form_submissions.service_item_id` y `contract_signatures.service_id`; valida el trigger del módulo. La `00331` se rehízo así (`contact_notes.service_id` conserva la suya: es una columna nueva que solo escribe el módulo), se ensayó, se aplicó y `verify-forms` dio 0. En la `00335`, `submission_item_hook` es lo único que pone `service_item_id` (al insertar, solo con un paso del mismo negocio, contacto y servicio; después no cambia) y `submission_hook` usa el `service_id` solo si es un servicio de ese negocio y ese contacto. `verify-servicios-migracion --s S02` comprueba que esas tres columnas no tengan clave foránea.

**Regla nueva para el resto de la corrida (Wendy, 8/11):** si una verificación falla por una restricción (clave foránea, CHECK, NOT NULL) que podría hacer fallar o perder algo que hoy funciona, no se frena: se vuelve atrás esa migración, se saca la restricción, se valida lo mismo en el trigger del módulo, se vuelve a aplicar y verificar, y se anota acá. Se frena solo si la base no vuelve a quedar como estaba, o si para seguir hay que cambiar o borrar datos existentes.

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

## Correcciones durante SV1 (8/11)

- **La 00332 se corrigió el mismo día.** · `verify-services` encontró que los validadores de la configuración (`validate_service_settings`, `validate_journey_template` y los del portal) hacían `v || 'texto'` sobre una lista `text[]`: Postgres lo lee como pegar dos listas y falla con `22P02`. Ninguna pantalla los usaba todavía y el módulo está apagado. · Se agregó `::text` a los 59 textos, se ensayó sobre la base, se reaplicó la migración entera (es idempotente y ninguna migración posterior redefine sus funciones) y se actualizó el SQL registrado. Mismo criterio que la 00231 y la 00259.
- **La CLI de Supabase a veces no puede abrir su rol temporal** (`28P01`, «failed to connect as temp role») cuando se le piden muchas consultas seguidas. · Cortó una pasada de `verify-sales` y otra de `verify-services`. · `verify-services` reintenta solo ese error (hasta 5 veces, con espera creciente); los demás `verify-*` se repiten si pasa.

- **La 00334 y la 00335 se corrigieron el mismo día (un enganche que no atrapaba un error).** · `verify-services` sv2 rompe adrede una tabla del módulo dentro de una transacción que se deshace, y la reunión NO se agendaba: `booking_hook` (y `sale_hook`) declaraban variables con el tipo de una tabla del módulo, y Postgres resuelve esas declaraciones al entrar a la función, antes del bloque `EXCEPTION`. · Se declaran como `record`; se ensayaron, se reaplicaron (son idempotentes) y se actualizó su SQL registrado. `verify-servicios-migracion` suma un chequeo que falla si un enganche vuelve a declarar un tipo del módulo, y `verify-services` prueba también la venta cancelada con el módulo roto. Ningún dato cambió (el módulo está apagado en todos los negocios).

## Decisiones de PRD (8/11)

- **Ajustes › Productos cambia solo con el módulo prendido.** · F114 rediseña la lista, el producto y la variante, pero «con el módulo apagado no cambia nada». · Apagado, la lista y la ficha son las de siempre (sin tocar una línea); prendido, tarjetas → producto → variante. La ruta de la variante con el módulo apagado muestra solo «Precio y cobro».
- **El drawer del workflow con sus pestañas Pasos e Historial (F117) queda simplificado.** · Editar los pasos dentro del camino duplicaría el lienzo de Automatizaciones. · Cada workflow se ve como su línea de chips con las cuentas de 30 días (ejecuciones, con error, esperando) y abre el editor completo con «Volver al camino» (validado: solo vuelve a una variante). «+ Workflow» crea la automatización en borrador con el disparador ya filtrado. Queda para después el drawer con Pasos/Historial en el lugar.
- **Borrar un paso o una fase pausa sus workflows al guardar el camino** (`saveJourneyTemplate` → `unpublishFlow`) y la pantalla dice cuántos. Nunca frena el guardado.
- **El link «Editar el contenido en Portal › programa»** apunta a `/dashboard/portal`, que llega con el bloque AC.
- **«Nota de precios deprecados»** de la página del producto no existe: no hay versiones de precio (D12).
- **`lib/publishing/disconnect-networks.test.ts` es inestable con la suite completa** (pasa solo; a veces falla por tiempo cuando corre todo junto). No es de esta rama.

## Decisiones de SV3 (8/11)

- **Clientes lee directo de las tablas, sin las vistas `services_list` / `clients_list` / `service_detail`.** · El plan las ponía en S04 (00333), que ya estaba aplicada; sumarlas hubiera sido otra migración fuera de la numeración. · Se lee con el cliente de quien mira (la RLS decide igual que una vista `security_invoker`), en tandas: una página de servicios y después sus contactos, fases y responsables en una consulta cada uno. Si hace falta velocidad, las vistas van en una migración propia.
- **«Clientes» va en el grupo Ventas del menú, no en un grupo «Servicios» nuevo.** · Un grupo nuevo cambia el orden de los grupos que fijan seis tests del menú (plano formularios-ui) aunque quede vacío. · Va al final de Ventas y solo se ve con el módulo prendido (bandera `services`). Se extendieron dos tests: la lista de ítems de `items.test.ts` (como se hizo con Diseñador IA) y la bandera del Admin en `active.test.ts`. «Portal» se suma igual en AC.
- **Los filtros «Accesos por vencer» y «Entregas por revisar»** responden vacío hasta que existan los accesos (AC) y las entregas (EV).

## Decisiones de AF (8/11)

- **Numeración:** otras ramas locales ya usan la `00338` y la `00339`. · Se renumeró S08–S16 (ver PROGRESS). · La S13 queda en la 00343 y se aplica antes que S08 (como decía el plan); no nombra nada de S08 a S12.
- **El link corto `/r/<código>/<link>` no adivina el negocio.** · El código y la clave del link son únicos por negocio, no en toda la instalación. · Se buscan los productos con esa clave y, de ésos, el negocio donde el código existe. Si quedan cero o más de uno, cae a la app (nunca a un negocio equivocado). La ruta solo redirige: la asignación la hace el toque que deja la página de destino (trigger de la 00343).
- **La venta hereda el afiliado vigente del contacto** (`inheritContactAffiliate`, segundo paso después de `create_sale`, que no se toca). · El plano pedía un campo «Afiliado» en el paso 1 del asistente. · Hoy la venta toma el del contacto y se cambia desde su ficha (con `affiliates.assign` y motivo). **Queda pendiente el campo en el asistente** para elegir otro al cargar; la acción del servidor (`setNewSaleAffiliate`) ya existe.
- **«Copiar con mi código» en Formularios y en Agenda** (F73) queda pendiente. · `withRef` ya arma el link con `?ref=`; falta el botón en las dos pantallas. · Mientras tanto, Mis links tiene los links de cada producto con el código.
- **Editar una comisión a mano** elige personas del equipo; pagarle a un contacto afiliado desde ese diálogo queda pendiente (la base ya lo acepta, `commission_edit` con `contact_id`). Las comisiones de un afiliado externo las genera la regla igual.
- **El resumen de afiliados cuenta como «comisiones» solo las de los roles que le pagan al afiliado de la venta** (`payee = sale_affiliate`), no todo lo que cobra esa persona.
- **`validate_affiliate_settings` no tenía gemela en TypeScript.** · Se sumó `lib/affiliates/settings.ts` con `affiliate-settings.cases.json`, y `verify-affiliates` corre los casos contra la base.
- **`commission_apply_max` (pagar solo la mayor) se compara en `verify-affiliates`**, no en `verify-commissions` (el plan lo ponía ahí). Corre los mismos casos de `when-also-seller.cases.json`.
- **El afiliado de una venta no se puede tocar con la sesión por dos lados:** `sales` no tiene política de UPDATE (0 filas) y, si la tuviera, la guarda dice AF010. `verify-affiliates` comprueba las dos cosas.

## Decisiones de AC (8/11)

- **El único de accesos vigentes es `(service_id, product_id, section)`**, no `(service_id, section)` como decía §8.2. · Un acceso extra puede ser de OTRO programa (F40), y con el único del plano un servicio no podía tener el Programa de su producto y el de otro a la vez. · Es más amplio, no más flojo: sigue sin haber dos vigentes de la misma sección y programa por servicio.
- **`portal_access` suma `until_type` y `workspace_id`.** · El corte al completar o renovar (F38) necesita saber qué accesos duran «lo que dure el servicio», y adivinarlo por la fecha falla. · `until_type` se guarda al abrir; extender a mano lo pasa a `manual`.
- **«Todavía no» = no hay fila, y una revocada no vuelve sola.** · El cron diario (`svc_access_tick`) y los hechos (fase, paso, Reto) abren solo lo que nunca se abrió. Volver a darlo es «Dar ahora» o un acceso extra.
- **El esquema del portal no se expone, así que las pantallas leen con funciones.** · `portal_admin_service_accesses` y `portal_admin_account` (corrección del mismo día de la 00341: el SQL registrado es el corregido) miran el permiso y el alcance con la sesión. Ni el servidor puede leer `app_servicio_portal` por REST.
- **Dos claves nuevas:** `services.access` (dar, extender, quitar y dar ahora un acceso) y `portal.accounts` (invitar, reenviar, suspender y reactivar). Las usa el plano (F40, F41) y no estaban en el catálogo. Owner y Admin las tienen; el Member no.
- **El pase de «Ver como estudiante» puede no tener cuenta** (`account_id` NULL con `kind <> 'student'`): un contacto sin email no tiene cuenta y igual se puede previsualizar. Lo cuida un CHECK.
- **Reactivar una cuenta suspendida** (`portal_admin_reactivate_account`) no estaba en el plano; sin ella, una suspensión por error no tenía vuelta.
- **Pendiente:** el aviso por email al email viejo cuando cambia el del contacto (hoy queda en el historial, sin email); la comprobación «Conectado» de la dirección del portal (`https://<host>/api/salud`, Parte 2); la mora corre en el cron diario de la S16 (`svc_access_tick` ya la incluye). La fusión de contactos con cuenta o accesos del portal la cubre el gancho de la S16.

## Decisiones de PR (8/11)

- **`program_live_recordings` (F51, el módulo calculado «Sesiones semanales») va en la S12 (CA)**, no en la S10. · Nombra `live_sessions` y `live_session_dates`, que nacen en la S12, y ninguna migración nombra tablas que todavía no existen.
- **La transcripción sin Voyage queda en `error`, no en `pending`.** · `indexText` (el mismo de Grabaciones) marca `error` si no hay Voyage; el plano decía `pending`. Se reintenta desde Conocimiento al conectar Voyage. El texto queda guardado igual.
- **El segundo de cada fragmento se escribe después de indexar** (`knowledge_chunks.start_second` por `chunk_index`), porque `indexText` no lo recibe. Solo con `.vtt` o `.srt`.
- **Quedan para después, con su lugar ya hecho:** «Copiar a otro programa» (F50); «Elegir un Fathom» para el video de una clase; la pestaña Programa de la ficha del servicio (avance por módulo y «Abrir ahora»: la función `svc_open_module_now` ya existe); arrastrar con el mouse en el árbol (se mueve con Subir/Bajar y Alt+↑/↓); la marca «Nuevo» de 7 días al abrirse algo oculto (es del portal, Parte 2).
- **Dos claves nuevas: `program.manage` y `program.activate`** (§4.1). Owner y Admin las tienen; el Member no. Y `portal.view` para ver el Portal sin cambiar nada.

## Decisiones de EV (8/11)

- **`submission_hook` de la 00335 no se toca.** · Las evaluaciones y actividades tienen sus propios triggers (antes de guardar: intento y nota; después: eventos y pasos del camino), que salen enseguida para los tipos de siempre. Así un error en lo nuevo no puede tocar las respuestas de Formularios.
- **`forms.product_id` borra en cascada con el producto** (los productos se archivan, no se borran; si alguna vez se borra uno, se van sus formularios del portal en vez de fallar el borrado).
- **Formularios no lista los del portal** (filtro en la página) y abrir uno por su URL da 404. La página pública ya los descartaba (`isPublicFormType`).

## Decisiones de CA (8/11)

- **Tres claves nuevas: `live_sessions.manage`, `attendance.manage` y `recordings.to_portal`** (§4.1). Owner y Admin; el Member no. «Agregar al portal» pide además la clave de lo que crea (`live_sessions.manage` para una fecha, `program.manage` para una clase): la base la vuelve a pedir igual.
- **Una persona del equipo siempre marca `team`.** · `attendance_mark` fuerza el origen cuando no lo llama el sistema; `self` y `click` los marca solo el portal (Parte 2). Así nadie del equipo puede fingir un clic.
- **El link de la reunión no se lee con la sesión** (privilegio por columna). La pantalla lo lee con el cliente de servicio, del negocio de la sesión, después del permiso de la página.
- **La grilla «Asistencia por estudiante» usa la base de cada fecha como «con acceso».** · La base ya exige acceso Calendario vigente y la variante de la sesión; con una base más chica (fase, días, variante) alguien con acceso pero fuera de la base se ve como «·». La ficha de la sesión sí lo distingue («Sin acceso ese día» / «Fuera de la base»).
- **«Se mide sobre: … (N)» en Próximas va sin el número.** · Contar la base de cada fecha futura es una consulta por fecha; se muestra el número en las Sesiones recurrentes (el de la última fecha) y en cada fecha pasada.
- **La asistencia del período se lee en una sola consulta** (`live_attendance_overview`, hasta 120 días); la pantalla mira los últimos 90.
- **«Clase» en los negocios que se creen después: al prender el módulo.** · La migración se lo sumó a los 6 negocios que ya tenían el área Servicio (F64). Un negocio nuevo con el módulo apagado nace igual que antes (4 áreas y 9 tipos: `verify-scheduling` lo exige); al prender el módulo, o al nacer el área con el módulo prendido, recibe «Clase». No se tocó `seed_booking_categories_for_workspace` (es de la Agenda).
- **Sacarle a `authenticated` una sola columna no sirve si tiene la tabla entera.** · La 1ª versión de la 00346 hacía `REVOKE SELECT (meeting_url)` y el link se seguía leyendo (lo atrapó `verify-program`). Ahora el permiso de `live_sessions` es por columnas, sin `meeting_url`. Una columna nueva que lea la pantalla se suma a ese `GRANT`.
- **Quedan para después:** la pestaña Asistencia de la ficha del servicio (la grilla del Calendario ya la tiene por estudiante); el disparador «Faltó» (lo emite el cron de la S16); la descripción con el resumen de la IA en «Agregar al portal» (hoy arranca vacía y se escribe a mano); el desbloqueo de la clase nueva se configura después en Contenido.

## Decisiones de CE (8/11)

- **El sujeto del certificado es `{module: "service", type: "service", id}`.** · El Diseñador acepta un sujeto solo si su `module` es un grupo registrado, y el grupo es `service` (el plano decía `servicios`).
- **El registro en el Diseñador se carga en los puntos de entrada del servidor** (las acciones de generar y listar generaciones, el nodo «Generar desde plantilla», el arranque de la cola), con `lib/designer/module-extensions.ts`, nunca al importar `generate-core`: así los tests del Diseñador siguen viendo el registro vacío.
- **«Emitirlo solo al llegar al paso» lo encola la base en la S16** (bloque X): el plano decía «sin migración» para CE, pero saber que un paso Certificado quedó abierto es del motor del camino. El job `svc_certificate_issue` ya existe y está registrado; hasta la S16, el paso se emite desde la ficha o con la acción de Automatizaciones.
- **«Uno vigente por servicio» lo cuida el módulo** (busca uno válido antes de generar), además de `replaceExisting: false` del Diseñador (que lo hace por contacto).
- **Un error al completar el paso no frena el diseño:** queda en `audit_log` (`svc.hook_failed`).
- **La 1ª pasada de `verify-program --bloque ce` dio «anular»: la pieza no estaba lista**, y en las dos siguientes pasó. No se encontró la causa; se vuelve a correr en el cierre (X) y, si se repite, se anota acá.

## Decisiones de CO (8/11)

- **Los espacios de fábrica son Anuncios (solo el equipo), General y Victorias**, mientras el programa no los configure. «clases» es reservado: no se puede usar como espacio del muro.
- **La pestaña «Comentarios» del editor de cada clase es un link a la Comunidad filtrada por esa clase** (`?tab=comunidad&clase=`), con el mismo muro, respuestas y moderación. El interruptor «Comentarios» de la clase ya existía (PR).
- **Una persona del equipo que se va deja su post como del negocio** (`author_user_id` pasa a NULL): el CHECK de autor lo admite.
- **`saveProgramSettings` deja pasar también `community.spaces` y `tutor.manage`**: la base pide la clave de cada parte del parche, así que nadie guarda lo que no le toca.
- **Borrar oculta y la purga a los 30 días va en el cron de la S16** (bloque X).

## Revisión visual (8/11)

- **No se pudo hacer en esta corrida.** · La app local (`localhost:3097`) pide iniciar sesión y en el navegador de la sesión no hay una abierta; la regla es no escribir credenciales. Además, las pantallas nuevas solo se ven con el módulo prendido, y solo se puede prender en un negocio de prueba. · Queda para Wendy, a 1440 y 390 px y en claro y oscuro, comparando con `claude/v12/prototipo-v12-panel.html`: Ajustes › Productos (tarjetas, producto, variante con sus cuatro pestañas, el drawer del paso, la regla de una sección del portal y la línea de workflows), Clientes (Servicios en tabla y tablero, Clientes, ficha del cliente, ficha del servicio, Importar servicios), la sección Servicios del contacto y de la venta, la columna Servicio en Ventas y los cinco pasos de Servicios en Automatizaciones. Con el módulo apagado, comprobar que Productos, Ventas, la ficha del contacto y de la venta y el editor de automatizaciones se ven iguales que antes.

## Pasos manuales de Wendy

- **Apagar "Allow new users to sign up"** en Supabase › Authentication. `verify-auth-settings` lo informa.
