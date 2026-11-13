// Extrae resultados CPM 06-2026-CG — Etapa de Evaluación Curricular.
// Formato por fila:
// - CALIFICA:    N° | TIPO DOC | DOCUMENTO | APELLIDOS Y NOMBRES | PERFIL | PUNTAJE | CONDICIÓN
// - NO CALIFICA / DESCALIFICA: N° | TIPO DOC | DOCUMENTO | PERFIL | - | CONDICIÓN
// (sin nombres y con guion en el puntaje, tal como figura en el PDF).
// Campos EXACTOS del PDF. Sin inventados.
// Salida pretty-print: src/data/resultados_curricular_2026.json
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const root = process.cwd();
const FILE = path.join(root, 'resultados', 'CPM_06_2026_Resultado_Evaluacion_Curricular.pdf');
const OUT = path.join(root, 'src', 'data', 'resultados_curricular_2026.json');

const CON_NOMBRE_RE = /^(\d+)\s+(DNI|CE|PASAPORTE|CARN[ÉE]T?)\s+(\S+)\s+(.+?)\s+(\d{2,4})\s+([\d.,]+)\s+([A-ZÁÉÍÓÚÑ ]+?)(\*)?$/;
const SIN_NOMBRE_RE = /^(\d+)\s+(DNI|CE|PASAPORTE|CARN[ÉE]T?)\s+(\S+)\s+(\d{2,4})\s+(-)\s+([A-ZÁÉÍÓÚÑ ]+?)(\*)?$/;

function numPuntaje(s) {
  const v = Number(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

(async () => {
  const parser = new PDFParse({ data: fs.readFileSync(FILE) });
  const result = await parser.getText();
  await parser.destroy();
  const pages = Array.isArray(result.pages) ? result.pages : [];
  const rows = [];
  const malas = [];
  let paginasConFilas = 0;

  pages.forEach((pg, idx) => {
    const lineas = String(pg.text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    let filas = 0;
    for (const line of lineas) {
      let m = line.match(CON_NOMBRE_RE);
      if (m) {
        const punt = numPuntaje(m[6]);
        if (punt === null || punt < 0 || punt > 20) { malas.push(`puntaje raro p${pg.num || idx + 1}: ${line.slice(0, 100)}`); continue; }
        filas++;
        rows.push({
          numero: Number(m[1]), tipo_doc: m[2], numero_documento: m[3],
          apellidos_nombres: m[4].trim(), numero_perfil: m[5],
          puntaje: m[6], condicion: (m[7] + (m[8] || '')).trim(),
        });
        continue;
      }
      m = line.match(SIN_NOMBRE_RE);
      if (m) {
        filas++;
        rows.push({
          numero: Number(m[1]), tipo_doc: m[2], numero_documento: m[3],
          apellidos_nombres: '', numero_perfil: m[4],
          puntaje: m[5], condicion: (m[6] + (m[7] || '')).trim(),
        });
        continue;
      }
      if (/^\d/.test(line)) malas.push(`p${pg.num || idx + 1}: ${line.slice(0, 110)}`);
    }
    if (filas) paginasConFilas++;
  });

  rows.sort((a, b) => a.numero - b.numero);

  // Validaciones duras: continuidad 1..N, sin duplicados, condiciones conocidas.
  const vistos = new Set(rows.map((r) => r.numero));
  const dups = rows.length - vistos.size;
  const huecos = [];
  for (let i = 1; i <= rows[rows.length - 1].numero; i++) if (!vistos.has(i)) huecos.push(i);
  if (dups || huecos.length) throw new Error(`Validación fallida: dups=${dups} huecos=${JSON.stringify(huecos.slice(0, 20))}`);
  const conds = {};
  for (const r of rows) conds[r.condicion] = (conds[r.condicion] || 0) + 1;
  const desconocidas = Object.keys(conds).filter((c) => !['CALIFICA', 'NO CALIFICA', 'DESCALIFICA'].includes(c));
  if (desconocidas.length) throw new Error(`Condiciones no previstas: ${desconocidas.join(', ')}`);
  const conNota = rows.filter((r) => r.puntaje !== '-');
  if (conNota.length !== rows.filter((r) => r.condicion === 'CALIFICA').length) {
    throw new Error('Solo las filas CALIFICA deben traer puntaje');
  }

  const payload = {
    metadata: {
      generadoEn: new Date().toISOString(),
      concurso: 'Concurso Público de Méritos N° 06-2026-CG',
      fuente: path.relative(root, FILE).replace(/\\/g, '/'),
      evaluacion: 'curricular',
      paginasPdf: pages.length,
      paginasProcesadas: pages.length,
      paginasConFilas,
      total: rows.length,
      condiciones: conds,
      nota: 'Campos exactos del PDF (nombres vacíos y puntaje "-" donde el PDF no los trae). Sin agregados.',
    },
    resultados: rows,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Páginas del PDF: ${pages.length} | procesadas: ${pages.length} | detectados: ${rows.length} ${JSON.stringify(conds)}`);
  console.log(`Generado ${path.relative(root, OUT)}`);
  if (malas.length) { console.warn(`Líneas con dígito no parseadas: ${malas.length}`); malas.slice(0, 10).forEach((l) => console.warn(' |' + l)); }
})();
