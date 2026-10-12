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

## Tanda 2 (pasos 5 a 7): hecha

| Paso | Commit | Qué quedó |
|------|--------|-----------|
| 5. El nodo en el canvas | `ccf2fda` | `branch-node.tsx` (una salida por camino con el id del camino, "Si no" = `else` al final), `BranchPanel.tsx`, el constructor general `components/automations/condition-builder.tsx` (más `lib/automations/condition-builder-model.ts`, puro, con la lógica), `VisibilityRuleBuilder` como envoltorio (`lib/forms/visibility-builder-adapter.ts`, formato guardado intacto), paleta con "Condiciones", `condition` visto como "Condición (sí / si no)" con "Convertir a Condiciones", server action `getConditionCatalogInputs`. |
| 6. Modelo de árbol | `4220074` | `lib/automations/step-tree.ts`: `flowToTree`, `treeToFlow`, `gateToBranch`, `describeTree` y los helpers de recorrido. Ida y vuelta exacta con 0 a 3 niveles; los 7 de la Agenda y las 4 plantillas de Formularios abren como árbol y conservan ids, tipos, datos y recorrido del motor. |
| 7a. Guardar el árbol | `b5e86ac` | `step-catalog.ts` (qué pasos hay en cada pantalla y sus validaciones), `step-tree-edit.ts` (operaciones puras), `step-tree-save.ts` (`prepareTreeSave`), `saveFormFlowTree` y `saveEventFlowTree`, `answer-conditions.ts`. |
| 7b. El editor de pasos | (este) | `step-tree-editor.tsx` + `step-list`, `step-card`, `branch-card`, `popover-menu`, `step-tree-context`. `linear-flow-editor.tsx` pasa a ser un envoltorio; las dos páginas leen con `flowToTree`. Prueba de humo que dibuja el editor con todas las formas (`step-tree-render.test.ts`). |

### API pública que usa la tanda siguiente

- **`lib/automations/step-tree.ts`**: tipos `StepTree { trigger: { id, data }, steps }`, `Step = ActionStep | GateStep | BranchStep`; `BranchStep { id, data, paths: BranchPathStep[] (cada uno es un `BranchPath` + `steps`), otherwise: Step[] }`. `flowToTree(nodes, edges): StepTree | null`, `treeToFlow(tree, random?): { nodes, edges }` (lanza `InvalidTreeError` si el árbol no tiene forma de grafo; `treeShapeProblems(tree)` lo dice antes), `gateToBranch`, `describeTree(tree, { when? })`, `allSteps`, `findStep`, `allIds`, `childLists`, `branchDepth`, `upstreamNodesOf(tree, stepId)`, `firstEmailStep`, `actionTypeOf`, `newStepId`, `MAX_BRANCH_DEPTH`.
- **`explainPaths`** se arma sobre `StepTree`: por cada `BranchStep`, `pickPath(step.paths, resolve)` (de `condition-eval.ts`) elige el camino; los pasos de antes para marcar "sin dato en la prueba" salen de `upstreamNodesOf` y los campos de `conditionGroupsFor(tree, branchId, inputs)` (`step-tree-edit.ts`). `getConditionCatalogInputs({ flowId, triggerData? })` trae lo del servidor (disparador, campos personalizados, tags, secuencias).
- **La plantilla** (paso 9) usa `treeToFlow` con un `StepTree` armado a mano: `newBranchStep(taken, firstCondition?)`, `newActionStep(actionKind("email"), taken)` y `blankBranchPath` ayudan. Hay que pasar por `prepareTreeSave` o por `treeShapeProblems` si viene de afuera.
- **La lista** (paso 9) usa `describeTree(flowToTree(nodes, edges))`; si es `null`, "Armado en el canvas".
- Para escribir desde un servidor: `prepareTreeSave({ screen, stored, tree, triggerData? })` devuelve `{ ok, graph, tree }` o `{ ok: false, error }`.

### Desvíos del plan (el código real ganó)

1. **Los caminos de Condiciones son planos** (una lista de condiciones con un solo "y / o"): el evaluador y el formato guardado de tanda 1 no tienen grupos anidados. El constructor sí los soporta (`allowGroups`) y los usan el "Solo si…" y la visibilidad de un campo; en Condiciones van apagados. "Esto o aquello pero además lo otro" se arma con dos caminos (gana el primero que se cumple).
2. **Una condición del formato viejo** (la que trae "Convertir a Condiciones": sin `valueType`, operador `equals`...) se muestra como frase con "quitala y armá una nueva". No se edita campo por campo, para no cambiar su semántica por accidente.
3. **La server action del catálogo es `getConditionCatalogInputs({ flowId, triggerData? })`**, sin `nodeId`: el servidor devuelve lo que solo él sabe y el navegador le suma los pasos de antes con el grafo que está editando (que puede tener cambios sin guardar). `triggerData` permite usar el disparador de la pantalla.
4. **El "Si" plano (`GateStep`) lleva adentro lo que corre si se cumple** (`steps`), en vez de ser una marca en una lista. Así no se puede mover un paso de un lado al otro de la condición sin querer. No se crea ni se edita desde el editor: solo se conserva, se borra o se convierte en Condiciones.
5. **Un "Si" guardado sin salida declarada se lee como "Si" y se escribe con `true`.** El motor nunca seguía esa arista (el flujo se cortaba en la condición), así que guardar desde el editor nuevo lo arregla. Es el único caso donde guardar cambia el comportamiento de un flujo; queda fijado en `editor-characterization.test.ts` y `step-tree.test.ts`.
6. **Condiciones en el medio de una lista**: lo que seguía pasa ADENTRO del primer camino (lo único que no pierde pasos ni los saca de la condición sin avisar). El editor lo anuncia. No se puede si empujar lo que seguía pasaría el tope de 3 niveles.
7. **Un "Si" y Condiciones no se mueven ni se duplican** (tienen que ser siempre el último paso de su lista; duplicar arrastraría todo lo que tienen adentro).
8. **El servidor no crea nodos que el editor no ofrece**: un paso que no está en el catálogo de esa pantalla solo se acepta si ya estaba guardado, con el mismo id, tipo y datos. Un paso sin tocar no se vuelve a validar (un flujo viejo con un dato raro no queda bloqueado).
9. **Un camino con nombre vacío se guarda como "Camino N"** (la base lo exige y el historial del contacto lo nombra); en el editor se ve como placeholder.
10. **Se frena guardar con una condición a medio armar** (`treeConditionProblems`), diciendo en qué camino. Un email vacío o parecido no se frena.
11. **`changeField` conserva el operador si sigue valiendo** en el campo nuevo (igual que el `VisibilityRuleBuilder` de siempre); el plan no lo especificaba para los campos tipados.
12. **`VisibilityRuleBuilder` suma una prop opcional `leadLabel`** ("Arrancar si" en el "Solo si…"); sin ella dice "Mostrar si" como siempre.
13. **`getFlowVariables` del canvas** buscaba `httpRequest` por `n.type` y los HTTP Request se guardan como `type: "action"`: ahora usa `canonicalNodeType`. Era trivial, quedó arreglado.
14. **El layout recalcula las posiciones** al guardar desde el editor de pasos (lo acomodado a mano en el canvas se reordena). Las aristas pierden `animated` y `style` del canvas (cosmético).
15. **`loadFormsWithFields`** (`registry/form-triggers.ts`) ahora se exporta: la página de Formularios la usa para las preguntas del "Solo si…" (versión publicada, o el borrador si nunca se publicó).
16. **Los pasos de la Agenda y de Formularios se editan más que antes**: email a una dirección fija o al anfitrión, mensaje con "saltear si no tiene teléfono" (`onlyIfPhone`), esperar, tags con sugerencias, estado de la reunión y cancelarla. Un mensaje con botones/imágenes se conserva tal cual y solo se edita su texto.
17. **Etiquetas del canvas**: la paleta ofrece "Condiciones"; el `condition` viejo se ve "Condición (sí / si no)" con salidas "Sí" / "Si no". El resto de la paleta sigue en inglés como estaba.

### Deuda anotada

- **Revisión visual pendiente** (necesita sesión de la app): escritorio y 390 px, el editor de pasos en Formularios y en la Agenda, el nodo y el panel de Condiciones en el canvas, y "Convertir a Condiciones". Lo que hay es `tsc`, `lint`, `build`, tests y una prueba de humo que dibuja el editor sin navegador.
- **No se aplicó la regla de parada de la Agenda**: no apareció nada que los tests no cubran (las 7 plantillas se abren, se guardan, conservan `onlyIfPhone`, y se dibujan). Igual hay que mirarla con los ojos.
- Las acciones viejas `saveFormLinearFlow` / `saveLinearFlow` y el módulo `linear-flow.ts` siguen exportados y con sus tests, pero ya no las usa ninguna pantalla. Se pueden borrar cuando se confirme visualmente el editor nuevo.
- `useConditionCatalog` pide el catálogo aunque el flujo sea de solo lectura (una consulta de más); no molesta.
- Si el catálogo no carga, Condiciones se puede ver pero no editar (se avisa arriba).
- Sin campos para ofrecer (un formulario sin preguntas publicadas y sin disparador con formulario), un camino nuevo nace sin condición y el editor lo marca.

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
