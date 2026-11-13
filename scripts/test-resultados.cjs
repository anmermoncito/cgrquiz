// Pruebas del módulo de resultados 2026 (aptitud, conocimientos, evaluación curricular, consolidado).
const fs = require('fs');
const assert = require('assert');

const A = JSON.parse(fs.readFileSync('src/data/resultados_aptitud_2026.json', 'utf8'));
const C = JSON.parse(fs.readFileSync('src/data/resultados_conocimientos_2026.json', 'utf8'));
const U = JSON.parse(fs.readFileSync('src/data/resultados_curricular_2026.json', 'utf8'));
const Q = JSON.parse(fs.readFileSync('src/data/postulantes2026.json', 'utf8'));
const rawA = fs.readFileSync('src/data/resultados_aptitud_2026.json', 'utf8');
const rawC = fs.readFileSync('src/data/resultados_conocimientos_2026.json', 'utf8');
const rawU = fs.readFileSync('src/data/resultados_curricular_2026.json', 'utf8');

// T1: totales y continuidad por archivo
for (const [t, D, n] of [['APT', A, 7222], ['CONOC', C, 12716], ['CURR', U, 7187]]) {
  assert.strictEqual(D.resultados.length, n, `T1 ${t} total`);
  const nums = D.resultados.map((r) => r.numero);
  assert.strictEqual(new Set(nums).size, n, `T1 ${t} sin duplicados`);
  for (let i = 1; i <= n; i++) assert.ok(nums.includes(i), `T1 ${t} hueco ${i}`);
}
console.log('T1 OK: APT 7222, CONOC 12716 y CURR 7187 continuos 1..N sin duplicados');

// T2: condiciones y puntajes válidos
assert.deepStrictEqual(A.metadata.condiciones, { CALIFICA: 7198, 'NO CALIFICA': 24 }, 'T2 APT conds');
assert.deepStrictEqual(C.metadata.condiciones, { CALIFICA: 7230, 'NO CALIFICA': 3350, 'NO SE PRESENTÓ': 2136 }, 'T2 CONOC conds');
assert.deepStrictEqual(U.metadata.condiciones, { CALIFICA: 4296, 'NO CALIFICA': 1370, DESCALIFICA: 1521 }, 'T2 CURR conds');
const numP2 = (s) => s === '-' ? null : Number(String(s).replace(',', '.'));
for (const D of [A, C, U]) {
  for (const r of D.resultados) {
    if (r.puntaje === '-') continue;
    const v = numP2(r.puntaje);
    assert.ok(v !== null && v >= 0 && v <= 20, `puntaje ${r.puntaje}`);
  }
}
console.log('T2 OK: condiciones y rangos de puntaje');

// T3: emparejamiento de DNIs sueltos (aptitud NO CALIFICA) y fila pegada (conoc 194)
const a7199 = A.resultados.find((r) => r.numero === 7199);
assert.strictEqual(a7199.numero_documento, '40743358', 'T3 apt 7199 con DNI');
const c194 = C.resultados.find((r) => r.numero === 194);
assert.strictEqual(c194.puntaje, '18', 'T3 conoc 194 puntaje separado');
assert.ok(c194.apellidos_nombres.endsWith('MILAGRO'), 'T3 conoc 194 nombre limpio');
console.log('T3 OK: emparejamiento posicional y fila pegada');

// T4: match con postulantes y puestos existentes
const qp = new Set(Q.postulantes.map((p) => p.numero_documento));
const docsA = new Set(A.resultados.map((r) => r.numero_documento));
const docsC = new Set(C.resultados.map((r) => r.numero_documento));
const docsU = new Set(U.resultados.map((r) => r.numero_documento));
assert.ok([...docsA].every((d) => qp.has(d)), 'T4 APT todos en postulantes');
assert.ok([...docsC].every((d) => qp.has(d)), 'T4 CONOC todos en postulantes');
assert.strictEqual([...docsA].filter((d) => docsC.has(d)).length, 7222, 'T4 intersección APT/CONOC');
assert.strictEqual([...docsU].filter((d) => docsA.has(d) && docsC.has(d)).length, 7186, 'T4 CURR en APT y CONOC');
assert.strictEqual([...docsU].filter((d) => !qp.has(d)).length, 1, 'T4 CURR: 1 documento fuera del padrón (fila 3649)');
console.log('T4 OK: APT/CONOC 0 huérfanos; CURR 7186 en ambas y 1 fuera del padrón');

// T5: consolidado simulado (unión por DNI + ponderado 20/30/30)
const numP = (s) => s === '-' ? null : Number(String(s).replace(',', '.'));
const mA = new Map(A.resultados.map((r) => [r.numero_documento, r]));
const mC = new Map(C.resultados.map((r) => [r.numero_documento, r]));
const mU = new Map(U.resultados.map((r) => [r.numero_documento, r]));
let conTres = 0, sinCurricular = 0, soloCurricular = 0;
const seen = new Set([...mA.keys(), ...mC.keys(), ...mU.keys()]);
for (const d of seen) {
  const a = mA.get(d), c = mC.get(d), u = mU.get(d);
  const pa = a ? numP(a.puntaje) : null, pc = c ? numP(c.puntaje) : null, pu = u ? numP(u.puntaje) : null;
  if (pa !== null && pc !== null && pu !== null) {
    conTres++;
    const prom = pa * 0.2 + pc * 0.3 + pu * 0.3;
    assert.ok(prom >= 0 && prom <= 16, 'ponderado en rango 0-16');
  } else if (a && c) sinCurricular++;
  if (!a && !c && u) soloCurricular++;
}
assert.strictEqual(seen.size, 12717, 'T5 unión total');
assert.strictEqual(conTres, 4295, 'T5 con las 3 notas numéricas');
assert.strictEqual(sinCurricular, 2927, 'T5 apt+conoc sin nota curricular numérica');
assert.strictEqual(soloCurricular, 1, 'T5 solo curricular');
console.log('T5 OK: consolidado 12717 (4295 con 3 notas, 2927 sin curricular, 1 solo curricular), ponderados 0-16');

// T6: paginación simulada (25/50/100/250): cobertura total, sin duplicados, última parcial
for (const size of [25, 50, 100, 250]) {
  const pages = Math.ceil(7222 / size);
  const got = [];
  for (let p = 1; p <= pages; p++) got.push(...A.resultados.slice((p - 1) * size, p * size));
  assert.strictEqual(got.length, 7222, `T6 size=${size} cobertura`);
  assert.strictEqual(new Set(got.map((r) => r.numero)).size, 7222, `T6 size=${size} sin duplicados`);
  assert.ok(got.length % size === 0 || got.slice(-(7222 % size)).length === 7222 % size, `T6 size=${size} última parcial`);
}
console.log('T6 OK: paginación exacta en 25/50/100/250');

// T7: JSON pretty + esquema exacto (7 campos del PDF + puntaje)
assert.ok(rawA.split('\n').length > 10000 && rawA.includes('\n      "numero"'), 'T7 pretty apt');
assert.ok(rawC.split('\n').length > 10000 && rawC.includes('\n      "numero"'), 'T7 pretty conoc');
assert.ok(rawU.split('\n').length > 10000 && rawU.includes('\n      "numero"'), 'T7 pretty curricular');
const KEYS = ['numero', 'tipo_doc', 'numero_documento', 'numero_perfil', 'apellidos_nombres', 'puntaje', 'condicion'];
assert.deepStrictEqual(Object.keys(A.resultados[0]), KEYS, 'T7 schema');
assert.ok(A.resultados.every((r) => Object.keys(r).length === 7), 'solo 7 campos apt');
assert.ok(C.resultados.every((r) => Object.keys(r).length === 7), 'solo 7 campos conoc');
assert.ok(U.resultados.every((r) => Object.keys(r).length === 7), 'solo 7 campos curricular');
console.log('T7 OK: pretty-print y esquema exacto');

// T8: evaluación curricular — CALIFICA con nombre y nota; el resto sin nombre y "-"
const curCal = U.resultados.filter((r) => r.condicion === 'CALIFICA');
assert.strictEqual(curCal.length, 4296, 'T8 CALIFICA');
assert.ok(curCal.every((r) => r.apellidos_nombres && r.puntaje !== '-'), 'T8 CALIFICA con nombre y nota');
const curResto = U.resultados.filter((r) => r.condicion !== 'CALIFICA');
assert.ok(curResto.every((r) => r.apellidos_nombres === '' && r.puntaje === '-'), 'T8 resto sin nombre ni nota');
assert.strictEqual(curResto.length, 2891, 'T8 NO CALIFICA + DESCALIFICA');
console.log('T8 OK: 4296 CALIFICA con nota; 2891 sin nota (NO CALIFICA/DESCALIFICA)');
console.log('TODAS LAS PRUEBAS DE RESULTADOS PASAN');
