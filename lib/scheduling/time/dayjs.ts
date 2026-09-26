// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Instancia única de dayjs para el módulo de agendamiento, con los plugins
 * que usa el código portado: `utc`, `timezone` e `isBetween`.
 *
 * Todo el módulo importa dayjs desde acá y no desde "dayjs", así los plugins
 * están siempre cargados. El resto de la app sigue con Intl y date-fns; dayjs
 * queda acotado a `lib/scheduling` y sus componentes.
 */
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import isBetween from "dayjs/plugin/isBetween";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

export type { Dayjs } from "dayjs";
export default dayjs;
