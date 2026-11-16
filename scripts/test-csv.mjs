// Pruebas del módulo de exportación CSV (src/csvExport.ts).
// Ejecutar: node --experimental-strip-types scripts/test-csv.mjs
import assert from 'node:assert';
import { buildCsv, csvFileName, downloadCsv, exportCsv } from '../src/csvExport.ts';

// C1: estructura básica con separador coma y CRLF
{
  const csv = buildCsv(
    [{ dni: '12345678', nombre: 'ANA', nota: 15.5 }],
    [
      { header: 'DNI', value: (r) => r.dni },
      { header: 'APELLIDOS Y NOMBRES', value: (r) => r.nombre },
      { header: 'PUNTAJE', value: (r) => r.nota },
    ],
  );
  assert.strictEqual(csv, 'DNI,APELLIDOS Y NOMBRES,PUNTAJE\r\n12345678,ANA,15.5');
}
console.log('C1 OK: encabezados y filas separados por coma con CRLF');

// C2: escapado RFC 4180 (comas, comillas, saltos de línea) y nulos
{
  const csv = buildCsv(
    [
      { texto: 'PEREZ, JUAN', otro: 'dice "hola"', salto: 'linea1\nlinea2' },
      { texto: null, otro: undefined, salto: 0 },
    ],
    [
      { header: 'TEXTO', value: (r) => r.texto },
      { header: 'OTRO', value: (r) => r.otro },
      { header: 'SALTO', value: (r) => r.salto },
    ],
  );
  const lineas = csv.split('\r\n');
  assert.strictEqual(lineas[1], '"PEREZ, JUAN","dice ""hola""","linea1\nlinea2"');
  assert.strictEqual(lineas[2], ',,0');
  // El campo con salto interno conserva el contenido íntegro al reparsear.
  assert.ok(csv.includes('"linea1\nlinea2"'));
}
console.log('C2 OK: comas, comillas y saltos de línea escapados; nulos vacíos');

// C3: exportación sin filas = solo encabezado
{
  const csv = buildCsv([], [{ header: 'A', value: () => '' }, { header: 'B', value: () => '' }]);
  assert.strictEqual(csv, 'A,B');
}
console.log('C3 OK: sin filas solo se emite el encabezado');

// C4: nombre de archivo seguro, sin tildes y ordenable
{
  const fecha = new Date(2026, 10, 16, 9, 5, 7);
  assert.strictEqual(csvFileName('Resultados Aptitud 2026', fecha), 'resultados-aptitud-2026_2026-11-16_090507.csv');
  assert.strictEqual(csvFileName('Evaluación Curricular / Consolidado', fecha), 'evaluacion-curricular-consolidado_2026-11-16_090507.csv');
  assert.strictEqual(csvFileName('   ', fecha), 'exportacion_2026-11-16_090507.csv');
}
console.log('C4 OK: nombre de archivo normalizado con sello de fecha');

// C5: descarga con BOM UTF-8, tipo MIME y nombre correctos
{
  const capturado = {};
  const originales = {
    Blob: globalThis.Blob,
    URL: globalThis.URL,
    document: globalThis.document,
    window: globalThis.window,
  };
  class BlobFalso {
    constructor(partes, opciones) {
      capturado.partes = partes;
      capturado.tipo = opciones?.type;
    }
  }
  globalThis.Blob = BlobFalso;
  globalThis.URL = { createObjectURL: () => 'blob:falso', revokeObjectURL: () => { capturado.revocada = true; } };
  globalThis.document = {
    createElement: () => ({ style: {}, click() { capturado.clic = true; }, remove() { capturado.removido = true; } }),
    body: { appendChild() {} },
  };
  globalThis.window = { setTimeout: (fn) => fn() };
  try {
    downloadCsv('prueba.csv', 'A,B\r\n1,2');
    assert.deepStrictEqual(capturado.partes, ['\uFEFF', 'A,B\r\n1,2'], 'BOM al inicio');
    assert.strictEqual(capturado.tipo, 'text/csv;charset=utf-8;');
    assert.strictEqual(capturado.clic, true, 'dispara la descarga');
    assert.strictEqual(capturado.removido, true, 'quita el enlace temporal');
    assert.strictEqual(capturado.revocada, true, 'libera la URL');
  } finally {
    globalThis.Blob = originales.Blob;
    globalThis.URL = originales.URL;
    globalThis.document = originales.document;
    globalThis.window = originales.window;
  }
}
console.log('C5 OK: BOM UTF-8, MIME text/csv y limpieza del enlace');

// C6: exportCsv usa buildCsv y respeta el orden de las filas filtradas
{
  const capturado = {};
  const originales = { Blob: globalThis.Blob, URL: globalThis.URL, document: globalThis.document, window: globalThis.window };
  globalThis.Blob = class { constructor(partes) { capturado.partes = partes; } };
  globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
  globalThis.document = { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } };
  globalThis.window = { setTimeout: (fn) => fn() };
  try {
    exportCsv('orden.csv', [{ n: 3 }, { n: 1 }, { n: 2 }], [{ header: 'N', value: (r) => r.n }]);
    assert.strictEqual(capturado.partes[1], 'N\r\n3\r\n1\r\n2');
  } finally {
    globalThis.Blob = originales.Blob;
    globalThis.URL = originales.URL;
    globalThis.document = originales.document;
    globalThis.window = originales.window;
  }
}
console.log('C6 OK: exportCsv conserva el orden recibido (filtros + orden vigentes)');
console.log('TODAS LAS PRUEBAS DE CSV PASAN');
