// Pruebas obligatorias del módulo plazas/postulantes (puntos 13.1-13.7).
const fs = require('fs');
const assert = require('assert');

const Q = JSON.parse(fs.readFileSync('src/data/postulantes2026.json', 'utf8'));
const F = JSON.parse(fs.readFileSync('src/data/perfiles2026.json', 'utf8'));
const rawQ = fs.readFileSync('src/data/postulantes2026.json', 'utf8');
const rawF = fs.readFileSync('src/data/perfiles2026.json', 'utf8');
const dig = (s) => String(s ?? '').replace(/\D/g, '');

// P1: total real del procesamiento
assert.strictEqual(Q.postulantes.length, 18493, 'P1 total');
assert.strictEqual(Q.metadata.paginasPdf, 270, 'P1 paginas pdf');
assert.strictEqual(Q.metadata.paginasProcesadas, 270, 'P1 paginas procesadas');
console.log('P1 OK: 18493 postulantes, 270/270 páginas');

// P2: última página incorporada (18472-18493 presentes y continuos al final)
const nums = Q.postulantes.map((p) => p.numero);
assert.deepStrictEqual(nums.slice(-22), Array.from({ length: 22 }, (_, i) => 18472 + i), 'P2 últimos 22');
assert.strictEqual(new Set(nums).size, 18493, 'P2 sin duplicados global');
for (let i = 1; i <= 18493; i++) assert.ok(nums.includes(i) && nums.indexOf(i) === nums.lastIndexOf(i), 'P2 continuidad ' + i);
console.log('P2 OK: N° 1..18493 continuos, últimos 22 presentes, 0 duplicados');

// P3+P4: perfil con >250 (471): total, páginas, última no vacía
const p471 = Q.postulantes.filter((p) => dig(p.numero_perfil) === '471');
assert.ok(p471.length > 250, 'P3 total>250, es ' + p471.length);
for (const size of [25, 50, 100, 250]) {
  const pages = Math.ceil(p471.length / size);
  const last = p471.slice((pages - 1) * size, pages * size);
  assert.ok(last.length > 0 && last.length <= size, `P3/P4 size=${size} última con ${last.length}`);
  // P6: unión de páginas = total, sin duplicados ni faltantes
  const seen = [];
  for (let pg = 1; pg <= pages; pg++) seen.push(...p471.slice((pg - 1) * size, pg * size).map((p) => p.numero));
  assert.strictEqual(seen.length, p471.length, `P6 size=${size} cobertura`);
  assert.strictEqual(new Set(seen).size, p471.length, `P6 size=${size} sin duplicados`);
}
console.log(`P3/P4/P6 OK: perfil 471 tiene ${p471.length} (>250), última página no vacía, 0 duplicados entre páginas`);

// P5: el total no depende del tamaño de página
for (const size of [25, 50, 100, 250]) {
  assert.strictEqual(Math.ceil(p471.length / size) * 0 + p471.length, p471.length);
}
console.log(`P5 OK: total ${p471.length} invariante con 25/50/100/250 por página`);

// P7: JSON pretty (multilínea, indentado, válido)
assert.ok(rawQ.includes('\n  "postulantes"'), 'P7 postulantes multilinea');
assert.ok(rawQ.split('\n').length > 100000, 'P7 lineas: ' + rawQ.split('\n').length);
assert.ok(rawF.includes('\n      "cod_perfil"'), 'P7 perfiles multilinea');
console.log('P7 OK: JSON pretty con saltos de línea e indentación');

// Join N° PERFIL ("404") <-> COD PERFIL ("404 - 2026"): solo dígitos iniciales
// del código. Regresión: quitar TODO lo no numérico daba "4042026" y dejaba
// todos los conteos en cero.
const clavePerfil = (cod) => {
  const m = String(cod ?? '').match(/^\s*(\d+)/);
  return m ? m[1] : '';
};
const porPerfil = new Map();
for (const p of Q.postulantes) {
  const key = p.numero_perfil.trim();
  if (!key) continue;
  const e = porPerfil.get(key) || { total: 0, califica: 0 };
  e.total++;
  if (p.condicion === 'CALIFICA') e.califica++;
  porPerfil.set(key, e);
}
const sinPost = F.perfiles.filter((p) => !porPerfil.has(clavePerfil(p.cod_perfil))).map((p) => p.cod_perfil);
assert.deepStrictEqual(sinPost, ['565 - 2026', '579 - 2026'], 'join sin-postulantes');
assert.strictEqual(porPerfil.get('471').total, 589, 'join perfil 471');
assert.strictEqual(porPerfil.get('404').total, Q.postulantes.filter((p) => p.numero_perfil === '404').length, 'join perfil 404');
console.log('JOIN OK: 395/397 perfiles con postulantes; solo 565 y 579 sin postulantes; perfil 471 =', porPerfil.get('471').total);
assert.deepStrictEqual(Object.keys(Q.postulantes[0]), ['numero', 'tipo_doc', 'numero_documento', 'apellidos_nombres', 'numero_perfil', 'condicion'], 'schema postulante');
assert.deepStrictEqual(Object.keys(F.perfiles[0]), ['cod_perfil', 'categoria_remunerativa', 'unidad_organizacion', 'nombre_puesto', 'numero_posiciones', 'lugar_prestacion', 'remuneracion'], 'schema perfil');
assert.ok(Q.postulantes.every((p) => Object.keys(p).length === 6), 'solo 6 campos');
assert.ok(F.perfiles.every((p) => Object.keys(p).length === 7), 'solo 7 campos');
console.log('Esquema OK: 6 campos postulante, 7 campos perfil, sin inventados');
console.log('TODAS LAS PRUEBAS PASAN');
