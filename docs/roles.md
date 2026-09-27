# Roles y permisos

Hasta la Etapa 2, un permiso era una sola pregunta: *¿es Owner o Admin?* Eso
alcanza con tres personas. Deja de alcanzar cuando hay alguien que tiene que
ver los dashboards pero no tocar las integraciones, o alguien que edita
contenido pero no lo publica.

## Los tres roles de sistema

Vienen con cada negocio y **no se editan**.

| Rol | Qué puede |
|---|---|
| **Owner** | Todo, incluida transferir la propiedad del negocio. |
| **Admin** | Todo menos transferir la propiedad. |
| **Member** | Ve y atiende los leads que tiene asignados. Crea contenido y lo manda a revisión. |

No se editan a propósito: si alguien le saca un permiso al rol Admin, la
mitad del sistema deja de andar sin que quede claro por qué. Para necesidades
distintas están los roles personalizados.

Lo que puede un Member es **exactamente lo que podía antes de la Etapa 2**.
No es una interpretación: hay un test (`lib/auth/member-baseline.test.ts`)
que recorre las páginas y las acciones del código real, mira qué guard usa
cada una, y lo compara con una tabla escrita a mano. La lista de permisos del
rol Member se deriva de ahí. Si alguien la cambia sin querer, el test falla
nombrando el archivo.

## Roles personalizados

Se crean en **Ajustes → Roles**. Un rol es un nombre, una descripción, una
lista de permisos y dos alcances.

Los permisos se agrupan por módulo, con un botón de "todos" por grupo. Son
treinta y cinco claves y armar un rol tildando de a una es tedioso.

Algunas combinaciones se corrigen solas al guardar, y la pantalla lo dice:

- **Responder sin ver** no tiene sentido: sin ver no se llega a la
  conversación. Se agrega "ver".
- **Editar sin ver**, lo mismo.
- Ver sin poder responder **sí** es válido: es alguien que supervisa.

Un rol sin ningún permiso se puede guardar, pero avisa: quien lo tenga no va
a poder hacer nada y no va a entender por qué.

## Los dos alcances

Además de *qué* puede hacer, un rol define *cuánto ve*:

| Alcance | Qué significa |
|---|---|
| **Solo los suyos** | Los leads y conversaciones donde está asignado como setter, vendedor o agente. |
| **Todos los del negocio** | Todo, como un Admin. |

Son dos alcances separados —leads y conversaciones— porque se puede querer
que alguien atienda cualquier conversación sin darle la ficha de todos los
contactos.

**El alcance lo aplica la base de datos**, no la pantalla. Las funciones
`can_see_contact` y `can_see_conversation` lo consultan, y las policies de
RLS las usan. Alguien que arme el pedido a mano tampoco ve de más.

## Cómo conviven con lo que ya había

La columna `workspace_members.role` **no cambió**: sigue siendo `owner`,
`admin` o `member`, y sigue siendo lo que leen las cuarenta policies que ya
existían. Al lado se sumó `role_id`, que apunta al rol con los permisos
finos.

Un rol personalizado es siempre un `member` con permisos de más. Así ninguna
policy vieja cambia de comportamiento, que era la condición para que este
cambio no rompiera nada.

## Asignar un rol

En **Ajustes → Equipo**, el selector de cada persona ofrece los roles del
negocio. Cambiarlo cambia `role_id`; `role` queda en `member`.

No se puede dejar al negocio **sin ningún Owner**: es la única persona que
puede transferir la propiedad y recuperar el workspace si algo sale mal.

## Borrar un rol

Un rol con gente asignada no se borra: hay que reasignarla primero. El aviso
dice cuántas personas son, porque "no se puede borrar" sin número obliga a ir
a buscar.

Todo cambio de roles queda en el registro de auditoría. Un rol es un permiso,
y después nadie se acuerda quién le dio a quién la posibilidad de publicar.

## Para quien toque el código

- El catálogo de claves está en `lib/auth/permissions.ts`. Es la fuente:
  los permisos de Owner, Admin y Member salen de ahí, no de la base.
- La fila de un rol de sistema tiene los permisos **vacíos a propósito**.
  Guardar una copia en la base daría dos fuentes que se pueden separar, y
  mandaría la que alguien mire primero.
- En el servidor se pregunta con `requirePermission(key)` para páginas y
  `getPermissionAction(key)` para acciones. `requireWorkspaceAdmin` y
  `getAdminContext` siguen existiendo y **no cambiaron de comportamiento**.
- En la base hay `has_permission(workspace_id, key)` y
  `permission_scope(workspace_id, module)`. Ojo con la primera: no conoce los
  permisos del rol Member de sistema, porque viven en TypeScript. Hoy ninguna
  policy la usa; el alcance lo resuelve `permission_scope`, que sí contempla
  los tres casos.
- `node scripts/verify-roles.mjs` prueba todo esto contra la base real con
  usuarios de verdad.
