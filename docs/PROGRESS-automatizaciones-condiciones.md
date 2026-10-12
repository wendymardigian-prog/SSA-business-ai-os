# Automatizaciones con caminos condicionales: avance

Rama `feat/automatizaciones-condiciones` (desde `origin/main` ad7581c). Plan en
`~/.claude/plans/vamos-a-darles-a-quizzical-hamming.md`. Sin migraciones.

## Tanda 1 (pasos 1 a 4): hecha

| Paso | Qué quedó |
|------|-----------|
| 1. Caracterización | `lib/automations/editor-characterization.test.ts` (11 grafos: los 7 de la Agenda y las 4 plantillas de Formularios; recorrido del MOTOR de verdad sobre la base en memoria, ida y vuelta lineal, qué formas acepta `flowToLinear`) y `lib/flow-engine/nodes/condition-characterization.test.ts` (tabla de contextos → salida del `condition`, los seis operadores). |
| 2. Evaluador tipado | `lib/flow-engine/condition-eval.ts` + `legacy-operators.ts`. |
| 3. Qué se puede comparar | `condition-catalog.ts`, `node-outputs.ts`, `variableSchema` en los triggers de Formularios, Agenda y Ventas, resolvers tipados en `registry/conditions.ts`. |
| 4. Nodo `branch` | `nodes/branch.ts`, `branch-paths.ts`, `convert-condition.ts`, caso `branch` en `simulator.ts`, `branch_taken` en `lib/contacts/history.ts`. |

## Desvíos del plan (el código real ganó)

1. **`registry.test.ts` pasa de 26 a 27 nodos, no de 23 a 24.** El plan contaba mal: antes de esta rama ya había 26 (Ventas sumó las tres acciones de cobranza). Comentado en el test.
2. **La caracterización de la Agenda ya existía** en `lib/scheduling/automation/linear-flow-characterization.test.ts` (solo comprobaba que la ida y vuelta conservara los `kind` de los pasos). Se dejó como está y se escribió una nueva más estricta en `lib/automations/` (la carpeta que el plan reserva para `step-tree.ts`).
3. **`linearToFlow` pierde `onlyIfPhone`** del mensaje (lo traen `reminder_1h` de la Agenda y `thank_you_message` de Formularios): hoy, guardar esos flujos desde el editor lineal les quita esa marca y el mensaje deja de saltearse cuando el contacto no tiene teléfono. No estaba en el plan. Quedó fijado como "HOY" en el test de caracterización: el editor de árbol tiene que guardar los datos del nodo tal cual (`treeToFlow` reusa `node.data` entero) y ese test se actualiza a propósito entonces.
4. **Los seis operadores viejos no "delegan en el registro"**: se sacaron a `lib/flow-engine/legacy-operators.ts` (puro, sin dependencias) y el registro (`registry/conditions.ts`) los registra desde ahí. Motivo: el evaluador corre también en el navegador, donde el registro de operadores no está cargado. Es la MISMA función en los dos lados y un test lo comprueba (`getConditionOperator(op).evaluate === legacy.evaluate`) además de la paridad sobre la tabla de valores. Una condición sin `valueType` usa la semántica vieja; una con `valueType` usa la tipada (así `gt` numérico tipado y `gt` viejo conviven).
5. **El operador `is_empty` también existe en fecha** (el plan no lo listaba). Sin él no hay forma de ramificar por "no cargó la fecha".
6. **Decisiones del evaluador que el plan no fijaba**: una lista vacía en `is_any_of` / `includes_any` / `includes_all` NO se cumple (una regla a medio armar no deja pasar a nadie); un sí/no que no se puede leer (ni "true" ni "false") no cumple ni `is_true` ni `is_false`; los números no aceptan coma decimal (`"1,5"` no es número: hoy no hay forma de saber si es 1,5 o 1.500); fechas `YYYY-MM-DD` son UTC y las comparaciones `before/after/between` son por día.
7. **`availableConditionFields` no recibe `trigger` ni `triggerConfig`**: el servidor ya calculó `triggerSchema` (con `variableSchema(config, ctx)`) y el catálogo solo ordena y agrupa. La firma real está en el reporte de la tanda.
8. **`variableSchema` de Formularios usa el borrador si el formulario nunca se publicó** (el plan decía "versión publicada"). Armar la automatización antes de publicar es el flujo normal; al publicar se vuelve a mirar y `staleConditions` avisa lo que haya cambiado.
9. **Con "cualquier formulario" en el disparador (sin `form_ids`) no se ofrecen preguntas**, solo `form.name` (y puntaje/NPS en encuestas): `commonFields([])` es vacío a propósito y el resolver igual contesta por clave si la pregunta existe.
10. **Agenda**: se ofrecen `booking.*` como texto; **no** `booking.answers.<clave>` (cambia por tipo de evento). **Ventas**: solo las variables que son texto en serio (producto, variante, estados, vendedor/setter, UTM, atribución, medio de pago); los montos y las fechas salen FORMATEADOS (`$1.297,00`, "12 de octubre") y no se pueden comparar como número o fecha.
11. **`NodeType` (lib/types/database.ts) suma `"branch"`** y `NodeData` suma `BranchNodeData` (solo tipos). `matchConditionField` acepta además prefijos que terminan en `.` (`answer.`, `form.`...) porque la ruta de un campo del `branch` es la misma que la de la variable.
12. **`branch` carga el contacto solo si hace falta, pero una condición SIN `valueType` (la que viene del nodo viejo) siempre lo necesita**: así "Convertir a Condiciones" da las mismas salidas que el `condition` (también sin contacto: todo falso). **Única diferencia documentada**: un nodo sin NINGUNA condición y sin contacto. El `condition` da `false`; el `branch` convertido se cumple (`and` vacío). No se da en la práctica (el motor siempre corre sobre un contacto) y hay un test que la fija.
13. **`app/(dashboard)/dashboard/contacts/[contactId]/page.tsx`** se tocó (no estaba en la lista de archivos): la consulta de `analytics_events` suma `branch_taken` y `metadata`. Sin eso `history.ts` no recibe nunca el evento.
14. **Fixtures**: la tabla de contextos del `condition` se movió a `lib/flow-engine/nodes/condition-fixtures.ts` para reusarla en `branch.test.ts` (conversión). La caracterización del paso 1 quedó igual de estricta.
15. **El simulador** suma `SimulationConfig.mockValues` (valores por ruta de campo para "Probar") y el `branch` sigue SOLO la salida que eligió: sin arista para esa salida el flujo termina (como el motor), no cae a "cualquier otra arista" como hacen los demás nodos del simulador.

## Para `docs/PENDIENTE.md` (lo escribe la tanda de cierre)

- **`variable:answer.x` no funciona en el `condition` viejo** (busca la clave `"answer.x"` de primer nivel y las respuestas están anidadas). Sigue igual a propósito; el `branch` lee `answer.*` por su cuenta.
- **A/B split del canvas** dibuja las salidas como `split-0`/`split-1` y el motor busca `A`/`B` (según el plan; no se verificó en esta tanda).
- **`linearToFlow` escribe el "Si" sin `sourceHandle: "true"` y las condiciones como texto JSON, sin `logic`**; y `flowToLinear` acepta un `condition` cuya única salida es `false` y lo muestra como "Si" (al revés). Fijado en `editor-characterization.test.ts`; lo arregla el editor de árbol.
- **Una arista que sale de un `condition` sin salida declarada nunca se sigue** (ni en el motor viejo ni en el `branch`).
- **Campos de Agenda en condiciones** (`has_upcoming_booking:`, `last_booking_status:`, `last_booking_result:`, `no_show_count:`) están registrados pero NO están en `CONDITION_FIELDS`, así que el catálogo no los ofrece. Sumarlos es una entrada con `valueType` en `condition-fields.ts`.
- **Ventas**: variables numéricas/de fecha para ramificar (montos, fechas de pago) pedirían un `variableSchema` que lea los valores sin formatear.
- **Un campo personalizado cuyo slug coincide con un campo reservado** (`platform`, `is_subscribed`...) queda tapado por el reservado (ya era así en el `condition`).
- **`branch_taken` por cada ejecución** consume el límite (`HISTORY_FETCH`) de la ficha del contacto en flujos muy usados.

## Verificación de la tanda

Ver el reporte final de la tanda (suite completa, `tsc`, `lint`).
