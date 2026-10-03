// Extrae el consolidado de posiciones CPM 06-2026-CG (formato distinto al 2022/2023:
// COD PERFIL | CATEGORÍA REMUNERATIVA | UNIDAD DE ORGANIZACIÓN | PUESTO |
// N° POSICIONES | LUGAR DE PRESTACIÓN | REMUNERACIÓN).
// Salida: src/data/perfiles2026.json
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const root = process.cwd();
const inFile = path.join(root, 'perfiles', 'CPM_06_2026_Anexo2.pdf');
const outPath = path.join(root, 'src', 'data', 'perfiles2026.json');

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const PUESTO_RE = /\b(AUDITOR\/A|ANALISTA|ESPECIALISTA|APOYO|T[EÉ]CNICO|ASISTENTE\/A)\b/;
const CATEGORIA_RE = /^(\d+)\s*-\s*2026\s+((?:ESPECIALISTA|APOYO) [IVX]+)\s+(.+)$/;

function parseRow(row) {
  const cut = row.replace(/(S\/\.\s*[\d,]+\.\d{2}).*$/, '$1');
  const codeMatch = cut.match(CATEGORIA_RE);
  if (!codeMatch) return { error: 'sin-codigo', row: row.slice(0, 100) };
  const numero = Number(codeMatch[1]);
  const categoria = codeMatch[2];
  let rest = clean(codeMatch[3]);
  const kw = rest.match(PUESTO_RE);
  if (!kw) return { error: 'sin-puesto', row: row.slice(0, 100) };
  const unidad = clean(rest.slice(0, kw.index)).toUpperCase();
  let tail = clean(rest.slice(kw.index));
  tail = tail.replace(/\s*(S\/\.\s*[\d,]+\.\d{2})\s*$/, '');
  const remuMatch = cut.match(/(S\/\.\s*[\d,]+\.\d{2})\s*$/);
  const m = tail.match(/^(.*)\s+(\d+)\s+([A-ZÁÉÍÓÚÑ][^0-9]*)$/);
  if (!m) return { error: 'sin-posiciones', row: tail.slice(0, 120) };
  return {
    cod_perfil: `${numero} - 2026`,
    categoria_remunerativa: categoria,
    unidad_organizacion: unidad,
    nombre_puesto: clean(m[1]).toUpperCase(),
    numero_posiciones: Number(m[2]),
    lugar_prestacion: clean(m[3]).toUpperCase(),
    remuneracion: remuMatch ? remuMatch[1].replace(/\s+/g, ' ') : null,
  };
}

(async () => {
  const parser = new PDFParse({ data: fs.readFileSync(inFile) });
  const result = await parser.getText();
  await parser.destroy();
  const lines = String(result.text || '')
    .replace(/\r/g, '')
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = [];
  let cur = null;
  for (const line of lines) {
    if (/^\d+\s*-\s*2026\b/.test(line)) {
      if (cur) rows.push(cur);
      cur = line;
    } else if (cur && !/^(Anexo N°|COD PERFIL)/i.test(line)) cur += ' ' + line;
  }
  if (cur) rows.push(cur);
  const perfiles = [];
  const errores = {};
  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed.error) {
      errores[parsed.error] = (errores[parsed.error] || 0) + 1;
      if (errores[parsed.error] <= 3) console.warn(`  [${parsed.error}] ${parsed.row}`);
      continue;
    }
    perfiles.push(parsed);
  }
  perfiles.sort((a, b) => Number(a.cod_perfil.replace(/\D/g, '')) - Number(b.cod_perfil.replace(/\D/g, '')));
  const unidades = [...new Set(perfiles.map((p) => p.unidad_organizacion))].sort((a, b) => a.localeCompare(b));
  const lugares = [...new Set(perfiles.map((p) => p.lugar_prestacion))].sort((a, b) => a.localeCompare(b));
  const payload = {
    metadata: {
      generadoEn: new Date().toISOString(),
      concurso: 'Concurso Público de Méritos N° 06-2026-CG',
      fuente: 'perfiles/CPM_06_2026_Anexo2.pdf',
      perfiles: perfiles.length,
      posiciones: perfiles.reduce((acc, p) => acc + p.numero_posiciones, 0),
      unidades: unidades.length,
      nota: 'Campos exactos del PDF, sin agregados.',
    },
    unidades,
    lugares,
    perfiles,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Generado ${path.relative(root, outPath)} con ${perfiles.length} perfiles, ${payload.metadata.posiciones} posiciones, ${unidades.length} unidades. Errores: ${JSON.stringify(errores)}`);
})();
