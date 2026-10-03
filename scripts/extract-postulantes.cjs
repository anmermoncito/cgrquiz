// Extrae postulantes del PDF de resultados de inscripción CPM 06-2026-CG.
// - Recorre TODAS las páginas del PDF (r.pages) y cuenta las procesadas.
// - La última página (269 del documento) es una hoja escaneada sin texto extraíble:
//   sus 22 registros (N° 18472-18493) se incorporan desde
//   postulantes/postulantes_2026_pagina269.json (transcripción verificada contra
//   la imagen de la página) y se validan por continuidad y duplicados.
// - Campos EXACTOS del PDF: numero, tipo_doc, numero_documento,
//   apellidos_nombres, numero_perfil, condicion. Sin campos inventados.
// Salida pretty-print: src/data/postulantes2026.json
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const root = process.cwd();
const inFile = path.join(root, 'postulantes', 'postulantes_2026.pdf');
const suplementoFile = path.join(root, 'postulantes', 'postulantes_2026_pagina269.json');
const outPath = path.join(root, 'src', 'data', 'postulantes2026.json');

const ROW_RE = /^(\d+)\s+(DNI|CE|PASAPORTE|CARN[ÉE][T]?)\s+(\S+)\s+(.+?)\s+(\d+)\s+([A-ZÁÉÍÓÚÑ ]+?)(\*)?$/;

(async () => {
  const parser = new PDFParse({ data: fs.readFileSync(inFile) });
  const result = await parser.getText();
  await parser.destroy();
  const pages = Array.isArray(result.pages) ? result.pages : [];
  const postulantes = [];
  const malas = [];
  let paginasConFilas = 0;
  pages.forEach((pg, idx) => {
    const lines = String(pg.text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    let filas = 0;
    for (const line of lines) {
      const m = line.match(ROW_RE);
      if (!m) {
        if (/^\d/.test(line)) malas.push(`p${pg.num || idx + 1}: ${line.slice(0, 110)}`);
        continue;
      }
      // La condición siempre cierra la fila; se conserva tal cual figura (incluido '*').
      filas += 1;
      postulantes.push({
        numero: Number(m[1]),
        tipo_doc: m[2],
        numero_documento: m[3],
        apellidos_nombres: m[4].trim(),
        numero_perfil: m[5],
        condicion: (m[6] + (m[7] || '')).trim(),
      });
    }
    if (filas) paginasConFilas += 1;
  });

  // Suplemento: última página escaneada (sin texto extraíble por ningún motor).
  const suplemento = JSON.parse(fs.readFileSync(suplementoFile, 'utf8'));
  const vistos = new Set(postulantes.map((p) => p.numero));
  let agregados = 0;
  for (const s of suplemento) {
    if (vistos.has(s.numero)) throw new Error(`Suplemento duplicado: N° ${s.numero} ya existe en el texto`);
    vistos.add(s.numero);
    postulantes.push({
      numero: s.numero,
      tipo_doc: s.tipo_doc,
      numero_documento: s.numero_documento,
      apellidos_nombres: s.apellidos_nombres,
      numero_perfil: s.numero_perfil,
      condicion: s.condicion,
    });
    agregados += 1;
  }
  postulantes.sort((a, b) => a.numero - b.numero);

  // Validaciones duras: continuidad total y cero duplicados.
  const dups = postulantes.length - new Set(postulantes.map((p) => p.numero)).size;
  const huecos = [];
  for (let i = 1; i <= postulantes[postulantes.length - 1].numero; i++) {
    if (!vistos.has(i)) huecos.push(i);
  }
  if (dups || huecos.length) {
    throw new Error(`Validación fallida: duplicados=${dups} huecos=${JSON.stringify(huecos.slice(0, 20))}`);
  }

  const condCount = {};
  for (const p of postulantes) condCount[p.condicion || '(vacía)'] = (condCount[p.condicion || '(vacía)'] || 0) + 1;
  const payload = {
    metadata: {
      generadoEn: new Date().toISOString(),
      concurso: 'Concurso Público de Méritos N° 06-2026-CG',
      fuente: 'postulantes/postulantes_2026.pdf',
      paginasPdf: pages.length,
      paginasProcesadas: pages.length,
      paginasConFilas,
      detectadosTexto: postulantes.length - agregados,
      suplementoPaginaEscaneada: {
        archivo: 'postulantes/postulantes_2026_pagina269.json',
        registros: agregados,
        motivo: 'La última página del PDF es una hoja escaneada (solo imágenes, cero operadores de texto): ningún extractor de texto puede leerla.',
      },
      total: postulantes.length,
      condiciones: condCount,
      nota: 'Campos exactos del PDF, sin agregados. La condición se conserva tal como figura (incluido el asterisco de 7 registros).',
    },
    postulantes,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log('Páginas del PDF:', pages.length);
  console.log('Páginas procesadas:', pages.length);
  console.log('Postulantes detectados:', postulantes.length);
  console.log(`(texto: ${postulantes.length - agregados} + página escaneada: ${agregados})`);
  if (malas.length) {
    console.warn(`Líneas con dígito inicial no parseadas: ${malas.length}`);
    malas.slice(0, 5).forEach((l) => console.warn('  |' + l));
  }
})();
