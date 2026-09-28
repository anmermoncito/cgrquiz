// Extrae el consolidado de posiciones (perfiles) de los anexos CPM 2023 y 2022.
// Salida: src/data/perfiles.json { metadata, byCodigo: { "0888-2023": {...} } }
// Cada fila del anexo ocupa varias líneas: COD / puesto / posiciones / nivel / carreras / región+lugar+remuneración.
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const root = process.cwd();
const FILES = [
  { file: path.join(root, 'perfiles', 'CPM_02_2023_Anexo2.pdf'), anio: 2023 },
  { file: path.join(root, 'perfiles', 'CPM 07-2022-CG_Anexo2_Consolidado_de_Posiciones.pdf'), anio: 2022 },
];
const outPath = path.join(root, 'src', 'data', 'perfiles.json');

const REGIONES = [
  'LIMA PROVINCIAS', 'MADRE DE DIOS', 'SAN MARTIN', 'LA LIBERTAD',
  'AMAZONAS', 'ANCASH', 'APURIMAC', 'AREQUIPA', 'AYACUCHO', 'CAJAMARCA',
  'CALLAO', 'CUSCO', 'HUANCAVELICA', 'HUANUCO', 'ICA', 'JUNIN',
  'LAMBAYEQUE', 'LIMA', 'LORETO', 'MOQUEGUA', 'PASCO', 'PIURA', 'PUNO',
  'TACNA', 'TUMBES', 'UCAYALI',
];
const REGION_DISPLAY = {
  JUNIN: 'JUNÍN', 'SAN MARTIN': 'SAN MARTÍN',
};
const REGION_RE = new RegExp(`\\b(${REGIONES.map((r) => r.replace(/ /g, '\\s+')).join('|')})\\b`);

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

const NIVEL_RE = /(TITULADO\s*,?\s*COLEGIADO\s+Y\s+HABILITADO\s+DE\s+CARRERA\s+UNIVERSITARIA|TITULADO\s+COLEGIADO\s+HABILITADO|TITULADO\s+DE\s+CARRERA\s+T[EÉ]CNICA\s+SUPERIOR|TITULADO\s+T[EÉ]CNICA\s+SUPERIOR|CARRERA\s+T[EÉ]CNICA\s+B[AÁ]SICA\s+COMPLETA|T[EÉ]CNICA\s+B[AÁ]SICA|BACHILLER\s+DE\s+CARRERA\s+UNIVERSITARIA|SECUNDARIA\s+COMPLETA|TITULADO[\s\S]{0,60}?UNIVERSITARIA|EGRESADO[\s\S]{0,60}?UNIVERSITARIA|SECUNDARIA|BACHILLER|TITULADO)/i;
const PUESTO_RE = /\b(AUDITOR\/A|ANALISTA|ESPECIALISTA|T[EÉ]CNICO\/A|ASISTENTE\/A|APOYO OPERATIVO\/A|APOYO OPERATIVO)\b/;
const REMU_RE = /S\/\.\s*[\d,]+\.\d{2}/;

function splitCarreras(raw) {
  const t = clean(raw);
  if (!t) return [];
  if (/^NO APLICA$/i.test(t)) return [];
  if (/TODAS LAS CARRERAS/i.test(t)) return ['TODAS LAS CARRERAS'];
  if (/CUALQUIER CARRERA/i.test(t)) return ['TODAS LAS CARRERAS'];
  return t
    .split(/\s+O\s+|\s+U\s+/)
    .map((c) => clean(c).toUpperCase())
    .filter((c) => c && !/OTRAS AFINES|POR LA FORMACI[OÓ]N|^U$|^O$/i.test(c));
}

function parseBlock(block) {
  const first = block[0];
  const codeMatch = first.match(/COD\s+([0-9]{3,4}-[0-9]{4})/i);
  if (!codeMatch) return { error: 'sin-codigo', first };
  const codigo = codeMatch[1];
  const rest0 = first.replace(/^\d+\s+COD\s+[\d-]+\s*/, '');
  const text = clean([rest0, ...block.slice(1)].join(' '));

  const nivelMatch = text.match(NIVEL_RE);
  if (!nivelMatch) return { codigo, error: 'sin-nivel', text: text.slice(0, 160) };
  const nivel_educativo = clean(nivelMatch[0]).toUpperCase();

  const head = text.slice(0, nivelMatch.index);
  const kw = head.match(PUESTO_RE);
  const puestoRaw = clean(kw ? head.slice(kw.index) : head);
  const tail = puestoRaw.match(/^(.*?)\s+(\d+)\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ/., ]*-\s*[IVXLCDM]+)?\s*$/);
  const puesto = clean(tail ? tail[1] : puestoRaw).toUpperCase();
  const posiciones = tail ? Number(tail[2]) : null;
  const categoria_remunerativa = tail && tail[3] ? clean(tail[3]).toUpperCase() : null;

  const after = text.slice(nivelMatch.index + nivelMatch[0].length);
  const afterNorm = norm(after);
  const regionMatch = afterNorm.match(REGION_RE);
  if (!regionMatch) return { codigo, error: 'sin-region', text: after.slice(0, 160) };
  const regionKey = clean(regionMatch[1]).replace(/\s+/g, ' ');
  const region = REGION_DISPLAY[regionKey] || regionKey;
  const carreras_raw = clean(after.slice(0, regionMatch.index)).toUpperCase();
  const carreras = splitCarreras(carreras_raw);

  const regionEnd = regionMatch.index + regionMatch[0].length;
  const remuMatch = afterNorm.slice(regionEnd).match(REMU_RE);
  const lugarChunk = clean(after.slice(regionEnd, remuMatch ? regionEnd + remuMatch.index : undefined));
  const lugares = lugarChunk
    .split(/(?=\bOCI\b)|(?=\bSEDE\b)/)
    .map((l) => clean(l))
    .filter((l) => l.length > 2);
  const remuneracion = remuMatch ? remuMatch[0].replace(/\s+/g, ' ') : null;

  return { codigo, puesto, posiciones, categoria_remunerativa, nivel_educativo, carreras_raw, carreras, region, lugares, remuneracion };
}

(async () => {
  const byCodigo = {};
  const stats = { filas: 0, ok: 0, errores: {} };
  for (const { file, anio } of FILES) {
    const parser = new PDFParse({ data: fs.readFileSync(file) });
    const result = await parser.getText();
    await parser.destroy();
    const lines = String(result.text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    const idx = [];
    lines.forEach((l, i) => { if (/COD\s+[0-9]{3,4}-[0-9]{4}/i.test(l)) idx.push(i); });
    console.log(`${path.basename(file)}: ${idx.length} filas COD`);
    for (let k = 0; k < idx.length; k += 1) {
      const block = lines.slice(idx[k], k + 1 < idx.length ? idx[k + 1] : lines.length);
      stats.filas += 1;
      const row = parseBlock(block);
      if (row.error) {
        stats.errores[row.error] = (stats.errores[row.error] || 0) + 1;
        if (stats.errores[row.error] <= 3) console.warn(`  [${row.error}] ${row.codigo || '?'} :: ${(row.text || row.first || '').slice(0, 120)}`);
        continue;
      }
      stats.ok += 1;
      byCodigo[row.codigo] = { ...row, anio };
    }
  }
  const carreras = [...new Set(Object.values(byCodigo).flatMap((r) => r.carreras))].sort((a, b) => a.localeCompare(b));
  const regiones = [...new Set(Object.values(byCodigo).map((r) => r.region))].sort((a, b) => a.localeCompare(b));
  const niveles = [...new Set(Object.values(byCodigo).map((r) => r.nivel_educativo))].sort((a, b) => a.localeCompare(b));
  const payload = {
    metadata: {
      generadoEn: new Date().toISOString(),
      filas: stats.filas,
      perfiles: Object.keys(byCodigo).length,
      errores: stats.errores,
      carreras,
      regiones,
      niveles,
      nota: 'Datos tomados de los anexos de consolidado de posiciones CPM 02-2023-CG y 07-2022-CG. Sin inventos.',
    },
    byCodigo,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\nGenerado ${path.relative(root, outPath)} con ${payload.metadata.perfiles} perfiles (${stats.filas} filas, errores: ${JSON.stringify(stats.errores)}).`);
  console.log(`Carreras distintas: ${carreras.length} | Regiones: ${regiones.length}`);
  const multi = Object.values(byCodigo).find((r) => r.lugares.length > 3);
  if (multi) console.log(`Ejemplo multi-lugar ${multi.codigo}: ${multi.lugares.length} lugares :: ${multi.lugares.slice(0, 3).join(' | ')}`);
})();
