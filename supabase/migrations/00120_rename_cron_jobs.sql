-- ============================================================
-- 00120_rename_cron_jobs.sql
--
-- Los 25 cron jobs se agendaron con el prefijo 'ssa-cron-' (00036 a 00092).
-- Las migraciones de origen ya se editaron para agendar sin el prefijo
-- ('jobs', 'sequences', 'purge-deleted', etc.): un clon nuevo, que corre esas
-- migraciones desde cero, nace directo con los nombres neutros y esta
-- migracion no encuentra nada que renombrar (el bloque de abajo es un no-op).
--
-- En una base donde 00036-00092 ya corrieron con los nombres viejos (como la
-- de produccion), hay que des-agendar cada 'ssa-cron-X' y agendar 'X' en su
-- lugar, con el mismo horario y el mismo comando que ya tenia: se leen de
-- `cron.job`, no se repiten a mano, para no poder transcribirlos mal.
--
-- Idempotente: una segunda corrida no encuentra ningun 'ssa-cron-%' (ya
-- renombrados) y no hace nada. Si pg_cron no esta habilitado (por ejemplo un
-- entorno de desarrollo sin la extension), tambien no hace nada.
-- ============================================================

do $$
declare
  r record;
  new_name text;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;

  for r in
    select jobid, jobname, schedule, command
    from cron.job
    where jobname like 'ssa-cron-%'
  loop
    new_name := regexp_replace(r.jobname, '^ssa-cron-', '');

    -- Por si una corrida anterior quedo a mitad de camino: no duplicar.
    if not exists (select 1 from cron.job where jobname = new_name) then
      perform cron.schedule(new_name, r.schedule, r.command);
    end if;

    perform cron.unschedule(r.jobid);
  end loop;
end $$;
