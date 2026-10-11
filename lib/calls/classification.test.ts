import { describe, it, expect } from 'vitest';
import {
  applyClassificationRules, countPeople, normalizeText, parseTermList,
  analysisStatusAfterClassify, headAndTail, type ClassificationRule,
} from './classification';

const RULES: ClassificationRule[] = [
  { id: 'r1', on: true, cond: 'duration_lt', value: 10, type: 'no_show' },
  { id: 'r2', on: true, cond: 'people_gte', value: 4, type: 'equipo' },
  { id: 'r3', on: true, cond: 'title_contains', value: ['WBR', 'Daily', 'Sesión semanal', 'coaching:', 'Vendedores Sales X'], type: 'equipo' },
  { id: 'r4', on: true, cond: 'only_team', type: 'equipo' },
  { id: 'r5', on: true, cond: 'has_appointment', type: 'cierre' },
];

const inv = (n: number) => Array.from({ length: n }, (_, i) => ({ email: `p${i}@x.com`, is_external: true }));
const voices = (n: number) => Array.from({ length: n }, (_, i) => ({ speaker: { display_name: `Voz ${i}` }, text: 'hola' }));
const LONG = 30 * 60;

describe('countPeople', () => {
  it('emails distintos, voces distintas y el mayor → people', () => {
    const r = countPeople([{ email: 'A@x.com' }, { email: 'a@x.com' }, { email: 'b@x.com' }], voices(5));
    expect(r).toEqual({ participants: 2, speakers: 5, people: 5 });
  });
});

describe('applyClassificationRules', () => {
  it('Impromptu con 1 invitado y 2 voces → null', () => {
    expect(applyClassificationRules({ title: 'Impromptu Google Meet Meeting', duration_seconds: LONG, attendees: inv(1), transcript: voices(2) }, RULES)).toBeNull();
  });
  it('Sesión semanal con 2 invitados y 7 voces → equipo', () => {
    expect(applyClassificationRules({ title: 'Sesión semanal - Reto X 30 días', duration_seconds: LONG, attendees: inv(2), transcript: voices(7) }, RULES)?.call_type).toBe('equipo');
  });
  it('WBR con 11 invitados → equipo', () => {
    const r = applyClassificationRules({ title: 'WBR SalesXcelerator', duration_seconds: LONG, attendees: inv(11), transcript: voices(2) }, RULES);
    expect(r).toEqual({ call_type: 'equipo', rule_label: '11 participantes' });
  });
  it('Tech Daily → equipo por título', () => {
    const r = applyClassificationRules({ title: 'Tech Daily [Xcelerator]', duration_seconds: LONG, attendees: inv(1), transcript: voices(2) }, RULES);
    expect(r).toEqual({ call_type: 'equipo', rule_label: 'título contiene «Daily»' });
  });
  it('normaliza tildes y mayúsculas; frase completa como subcadena', () => {
    const rules: ClassificationRule[] = [{ cond: 'title_contains', value: ['sesion semanal'], type: 'equipo' }];
    expect(applyClassificationRules({ title: 'Sesión Semanal' }, rules)?.call_type).toBe('equipo');
    const rules2: ClassificationRule[] = [{ cond: 'title_contains', value: ['Sesión semanal'], type: 'equipo' }];
    expect(applyClassificationRules({ title: 'Revisión semanal' }, rules2)).toBeNull();
  });
  it('gana la primera regla del array; invertido gana la otra', () => {
    const m = { title: 'Daily', duration_seconds: 60 };
    const a: ClassificationRule[] = [{ cond: 'duration_lt', value: 10, type: 'no_show' }, { cond: 'title_contains', value: ['Daily'], type: 'equipo' }];
    expect(applyClassificationRules(m, a)?.call_type).toBe('no_show');
    expect(applyClassificationRules(m, [...a].reverse())?.call_type).toBe('equipo');
  });
  it('una regla con on: false se saltea', () => {
    const rules: ClassificationRule[] = [{ on: false, cond: 'duration_lt', value: 10, type: 'no_show' }];
    expect(applyClassificationRules({ duration_seconds: 60 }, rules)).toBeNull();
  });
  it('5 minutos → no_show', () => {
    expect(applyClassificationRules({ title: 'x', duration_seconds: 300 }, RULES)).toEqual({ call_type: 'no_show', rule_label: 'menos de 10 min' });
  });
  it('con cita → cierre', () => {
    expect(applyClassificationRules({ title: 'Llamada', duration_seconds: LONG, attendees: inv(1), transcript: voices(2), booking_id: 'a1' }, RULES)).toEqual({ call_type: 'cierre', rule_label: 'cita de ventas' });
  });
  it('normaliza la antigua regla de cita «venta» a cierre', () => {
    const legacy: ClassificationRule[] = [{ cond: 'has_appointment', type: 'venta' }];
    expect(applyClassificationRules({ booking_id: 'a1' }, legacy)?.call_type).toBe('cierre');
  });
  it('email_contains', () => {
    const rules: ClassificationRule[] = [{ cond: 'email_contains', value: ['@cliente.com'], type: 'cliente' }];
    expect(applyClassificationRules({ attendees: [{ email: 'ana@cliente.com' }] }, rules)).toEqual({ call_type: 'cliente', rule_label: 'email «@cliente.com»' });
  });
  describe('only_team', () => {
    const rules: ClassificationRule[] = [{ cond: 'only_team', type: 'equipo' }];
    const team = ['ana@salesx.io', 'juan@salesx.io', 'luis@salesx.io'];
    const names = ['Ana Perez', 'Juan Mora', 'Luis Vega'];
    const att = (n: number) => team.slice(0, n).map((email) => ({ email, is_external: false }));
    const tr = (...n: string[]) => n.map((display_name) => ({ speaker: { display_name } }));

    it('1 invitado del equipo y 2 voces del equipo → no decide (evidencia débil)', () => {
      expect(applyClassificationRules({ attendees: att(1), transcript: tr('Ana Perez', 'Juan Mora') }, rules, team, names)).toBeNull();
    });
    it('2 invitados del equipo → no decide', () => {
      expect(applyClassificationRules({ attendees: att(2), transcript: tr('Ána Pérez', 'Juan Mora') }, rules, team, names)).toBeNull();
    });
    it('3 invitados del equipo y todas las voces del equipo → equipo', () => {
      expect(applyClassificationRules({ attendees: att(3), transcript: tr('Ána Pérez', 'Juan Mora') }, rules, team, names)?.rule_label).toBe('solo equipo');
    });
    it('una voz externa → nunca equipo', () => {
      expect(applyClassificationRules({ attendees: att(3), transcript: tr('Ana Perez', 'Lead') }, rules, team, names)).toBeNull();
    });
  });
});

describe('helpers', () => {
  it('parseTermList', () => {
    expect(parseTermList(' WBR, ,Daily ,Sesión semanal')).toEqual(['WBR', 'Daily', 'Sesión semanal']);
  });
  it('normalizeText', () => {
    expect(normalizeText('  Sesión   SEMANAL ')).toBe('sesion semanal');
  });
  it('analysisStatusAfterClassify', () => {
    const o = { auto: true, analyzeTypes: ['cierre', 'seguimiento'] };
    expect(analysisStatusAfterClassify('cierre', o)).toBe('pending');
    expect(analysisStatusAfterClassify('venta', o)).toBe('pending');
    expect(analysisStatusAfterClassify('equipo', o)).toBe('not_applicable');
    // En SSA el modo automatico no cambia el estado: lo distingue el motivo (F22).
    expect(analysisStatusAfterClassify('cierre', { ...o, auto: false })).toBe('pending');
    expect(analysisStatusAfterClassify('cierre', { ...o, lowConfidence: true })).toBe('needs_review');
  });
  it('headAndTail conserva el final', () => {
    const t = 'a'.repeat(50) + 'FIN';
    const r = headAndTail(t, 20, 10);
    expect(r.endsWith('FIN')).toBe(true);
    expect(r).toContain('parte central omitida');
  });
});

describe('tipos base', () => {
  it('son los ocho del alcance, con `cliente` y no `cliente_cx`', async () => {
    const { BASE_CALL_TYPES } = await import('./classification');
    expect([...BASE_CALL_TYPES]).toEqual(['cierre', 'seguimiento', 'triaje', 'equipo', 'cliente', 'clase', 'no_show', 'otra']);
  });
});
