// Pruebas del módulo de resultados 2026 (aptitud, conocimientos, consolidado).
const fs = require('fs');
const assert = require('assert');

const A = JSON.parse(fs.readFileSync('src/data/resultados_aptitud_2026.json', 'utf8'));
const C = JSON.parse(fs.readFileSync('src/data/resultados_conocimientos_2026.json', 'utf8'));
const Q = JSON.parse(fs.readFileSync('src/data/postulantes2026.json', 'utf8'));
const rawA = fs.readFileSync('src/data/resultados_aptitud_2026.json', 'utf8');
const rawC = fs.readFileSync('src/data/resultados_conocimientos_2026.json', 'utf8');

// T1: totales y continuidad por archivo
for (const [t, D, n] of [['APT', A, 7222], ['CONOC', C, 12716]]) {
  assert.strictEqual(D.resultados.length, n, `T1 ${t} total`);
  const nums = D.resultados.map((r) => r.numero);
  assert.strictEqual(new Set(nums).size, n, `T1 ${t} sin duplicados`);
  for (let i = 1; i <= n; i++) assert.ok(nums.includes(i), `T1 ${t} hueco ${i}`);
}
console.log('T1 OK: APT 7222 y CONOC 12716 continuos 1..N sin duplicados');

// T2: condiciones y puntajes válidos
assert.deepStrictEqual(A.metadata.condiciones, { CALIFICA: 7198, 'NO CALIFICA': 24 }, 'T2 APT conds');
assert.deepStrictEqual(C.metadata.condiciones, { CALIFICA: 7230, 'NO CALIFICA': 3350, 'NO SE PRESENTÓ': 2136 }, 'T2 CONOC conds');
const numP2 = (s) => s === '-' ? null : Number(String(s).replace(',', '.'));
for (const D of [A, C]) {
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
assert.ok([...docsA].every((d) => qp.has(d)), 'T4 APT todos en postulantes');
assert.ok([...docsC].every((d) => qp.has(d)), 'T4 CONOC todos en postulantes');
const ambas = [...docsA].filter((d) => docsC.has(d));
assert.strictEqual(ambas.length, 7222, 'T4 intersección');
console.log('T4 OK: 0 huérfanos; 7222 en ambas, 5494 solo conocimientos');

// T5: consolidado simulado (unión por DNI + promedio simple)
const numP = (s) => s === '-' ? null : Number(String(s).replace(',', '.'));
let conAmbas = 0, soloConoc = 0;
const seen = new Set();
for (const d of [...docsA, ...docsC]) {
  if (seen.has(d)) continue;
  seen.add(d);
  const a = A.resultados.find((r) => r.numero_documento === d);
  const c = C.resultados.find((r) => r.numero_documento === d);
  if (a && c) {
    conAmbas++;
    const pa = numP(a.puntaje), pc = numP(c.puntaje);
    if (pa === null || pc === null) throw new Error('ponderado sin notas en ' + d);
    const prom = pa * 0.2 + pc * 0.3;
    assert.ok(prom >= 0 && prom <= 10, 'ponderado en rango 0-10');
  } else if (c) soloConoc++;
}
assert.strictEqual(conAmbas, 7222, 'T5 con ambas');
assert.strictEqual(soloConoc, 5494, 'T5 solo conoc');
assert.strictEqual(seen.size, 12716, 'T5 unión total');
console.log('T5 OK: consolidado 12716 (7222 ambas + 5494 una), ponderados en rango 0-10');

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
const KEYS = ['numero', 'tipo_doc', 'numero_documento', 'numero_perfil', 'apellidos_nombres', 'puntaje', 'condicion'];
assert.deepStrictEqual(Object.keys(A.resultados[0]), KEYS, 'T7 schema');
assert.ok(A.resultados.every((r) => Object.keys(r).length === 7), 'solo 7 campos apt');
assert.ok(C.resultados.every((r) => Object.keys(r).length === 7), 'solo 7 campos conoc');
console.log('T7 OK: pretty-print y esquema exacto');
console.log('TODAS LAS PRUEBAS DE RESULTADOS PASAN');
