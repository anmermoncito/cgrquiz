// Extrae resultados CPM 06-2026-CG (aptitud y conocimientos).
// Formatos por sección:
// - CALIFICA: N° | TIPO DOC | DOCUMENTO | PERFIL | NOMBRES | PUNTAJE | CONDICIÓN
//   (el puntaje a veces sale pegado al nombre: "...MILAGRO18 CALIFICA").
// - NO CALIFICA conocimientos: N° | DOCUMENTO | PERFIL | PUNTAJE | CONDICIÓN | [TIPO al final].
// - NO CALIFICA aptitud: tabla en 2 columnas; izquierda N°|TIPO|PERFIL|PUNTAJE|COND,
//   derecha N° DE DOCUMENTO (se emparejan por posición).
// Campos EXACTOS del PDF + puntaje (que sí figura). Sin inventados.
// Salida pretty-print: src/data/resultados_{aptitud,conocimientos}_2026.json
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const root = process.cwd();
const FILES = [
  { file: path.join(root, 'resultados', 'CPM_06_2026_Resultados_Evaluación_Aptitud.pdf'), tag: 'aptitud', out: 'resultados_aptitud_2026.json' },
  { file: path.join(root, 'resultados', 'CPM_06_2026_Resultados_Evaluacion_Conocimientos.pdf'), tag: 'conocimientos', out: 'resultados_conocimientos_2026.json' },
];

const CAL_RE = /^(\d+)\s+(DNI|CE|PASAPORTE|CARN[ÉE][T]?)\s+(\S+)\s+(\d+)\s+(.+?)\s*(\d{1,3}(?:[.,]\d{1,2})?)\s+([A-ZÁÉÍÓÚÑ ]+?)(\*)?$/;
const NC_CONOC_RE = /^(\d+)\s+(\d{6,9})\s+(\d{2,4})\s+([\d.,]+)\s+(NO CALIFICA)\s*(DNI|CE)?\s*(\*)?$/;
const NC_APT_RE = /^(\d+)\s+(DNI|CE)\s+(\d{2,4})\s+([\d.,]+)\s+(NO CALIFICA)\s*(\*)?$/;
const NSP_RE = /^(\d+)\s+(\d{6,9})\s+(\d{2,4})\s+(-)\s+(NO SE PRESENTÓ)\s*(DNI|CE)?\s*(\*)?$/;
const DOC_RE = /^(\d{6,9})$/;

function numPuntaje(s) {
  const v = Number(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

async function parseFile({ file, tag }) {
  const parser = new PDFParse({ data: fs.readFileSync(file) });
  const result = await parser.getText();
  await parser.destroy();
  const pages = Array.isArray(result.pages) ? result.pages : [];
  const rows = [];
  const malas = [];
  const dnisSueltos = [];
  let paginasConFilas = 0;
  pages.forEach((pg, idx) => {
    const lines = String(pg.text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    let filas = 0;
    for (const line of lines) {
      let m = line.match(CAL_RE);
      if (m) {
        const punt = numPuntaje(m[6]);
        if (punt === null || punt < 0 || punt > 20) { malas.push(`puntaje raro p${pg.num || idx + 1}: ${line.slice(0, 100)}`); continue; }
        filas++;
        rows.push({ numero: Number(m[1]), tipo_doc: m[2], numero_documento: m[3], numero_perfil: m[4], apellidos_nombres: m[5].trim(), puntaje: m[6], condicion: (m[7] + (m[8] || '')).trim(), _pag: pg.num || idx + 1 });
        continue;
      }
      m = line.match(NC_CONOC_RE);
      if (m) {
        const punt = numPuntaje(m[4]);
        if (punt === null || punt < 0 || punt > 20) { malas.push(`puntaje raro p${pg.num || idx + 1}: ${line.slice(0, 100)}`); continue; }
        filas++;
        rows.push({ numero: Number(m[1]), tipo_doc: m[6] || '', numero_documento: m[2], numero_perfil: m[3], apellidos_nombres: '', puntaje: m[4], condicion: (m[5] + (m[7] || '')).trim(), _pag: pg.num || idx + 1 });
        continue;
      }
      m = line.match(NC_APT_RE);
      if (m) {
        const punt = numPuntaje(m[4]);
        if (punt === null || punt < 0 || punt > 20) { malas.push(`puntaje raro p${pg.num || idx + 1}: ${line.slice(0, 100)}`); continue; }
        filas++;
        rows.push({ numero: Number(m[1]), tipo_doc: m[2], numero_documento: '', numero_perfil: m[3], apellidos_nombres: '', puntaje: m[4], condicion: (m[5] + (m[6] || '')).trim(), _pag: pg.num || idx + 1, _sinDoc: true });
        continue;
      }
      m = line.match(NSP_RE);
      if (m) {
        filas++;
        rows.push({ numero: Number(m[1]), tipo_doc: m[6] || '', numero_documento: m[2], numero_perfil: m[3], apellidos_nombres: '', puntaje: '-', condicion: (m[5] + (m[7] || '')).trim(), _pag: pg.num || idx + 1 });
        continue;
      }
      const d = line.match(DOC_RE);
      if (d) { dnisSueltos.push({ doc: d[1], pag: pg.num || idx + 1 }); continue; }
      if (/^\d/.test(line)) malas.push(`p${pg.num || idx + 1}: ${line.slice(0, 110)}`);
    }
    if (filas) paginasConFilas++;
  });
  return { pages, rows, malas, dnisSueltos, paginasConFilas };
}

(async () => {
  for (const spec of FILES) {
    console.log(`\n=== ${spec.tag}: ${path.basename(spec.file)} ===`);
    const { pages, rows, malas, dnisSueltos, paginasConFilas } = await parseFile(spec);
    // Emparejar DNIs sueltos (aptitud NO CALIFICA, columna derecha por posición)
    const sinDoc = rows.filter((r) => r._sinDoc);
    if (dnisSueltos.length) {
      if (dnisSueltos.length !== sinDoc.length) {
        throw new Error(`Emparejamiento imposible: ${sinDoc.length} filas sin DNI vs ${dnisSueltos.length} DNIs sueltos`);
      }
      sinDoc.forEach((r, i) => { r.numero_documento = dnisSueltos[i].doc; delete r._sinDoc; });
      console.log(`  DNIs emparejados por posición: ${dnisSueltos.length}`);
    } else if (sinDoc.length) {
      throw new Error(`Hay ${sinDoc.length} filas sin documento y ningún DNI suelto`);
    }
    rows.forEach((r) => delete r._pag);
    rows.sort((a, b) => a.numero - b.numero);
    // Validaciones duras
    const vistos = new Set(rows.map((r) => r.numero));
    const dups = rows.length - vistos.size;
    const huecos = [];
    for (let i = 1; i <= rows[rows.length - 1].numero; i++) {
      if (!vistos.has(i)) huecos.push(i);
    }
    if (dups || huecos.length) throw new Error(`Validación fallida: dups=${dups} huecos=${JSON.stringify(huecos.slice(0, 20))}`);
    // (los puntajes ya se validaron 0-20 por fila; '-' solo en NO SE PRESENTÓ)
    const conds = {};
    for (const r of rows) conds[r.condicion] = (conds[r.condicion] || 0) + 1;
    const payload = {
      metadata: {
        generadoEn: new Date().toISOString(),
        concurso: 'Concurso Público de Méritos N° 06-2026-CG',
        fuente: path.relative(root, spec.file).replace(/\\/g, '/'),
        evaluacion: spec.tag,
        paginasPdf: pages.length,
        paginasProcesadas: pages.length,
        paginasConFilas,
        total: rows.length,
        condiciones: conds,
        nota: 'Campos exactos del PDF (nombres vacíos donde el PDF no los trae). Sin agregados.',
      },
      resultados: rows,
    };
    const outPath = path.join(root, 'src', 'data', spec.out);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log(`  Páginas del PDF: ${pages.length} | procesadas: ${pages.length} | detectados: ${rows.length} ${JSON.stringify(conds)}`);
    console.log(`  Generado ${path.relative(root, outPath)}`);
    if (malas.length) { console.warn(`  Líneas con dígito no parseadas: ${malas.length}`); malas.slice(0, 5).forEach((l) => console.warn('   |' + l)); }
  }
})();
