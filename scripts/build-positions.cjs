const fs = require('fs');
const path = require('path');

const root = process.cwd();
const bankPath = path.join(root, 'src', 'data', 'examenes.json');
const outPath = path.join(root, 'src', 'data', 'puestos.json');

const NO_VERIFICADA = 'Carrera no verificada / pendiente';

function slug(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function validYear(value) {
  const n = Number(value);
  return n >= 1990 && n <= 2035 ? n : null;
}

// Extrae códigos individuales "NNNN-AAAA" del encabezado o del nombre del archivo.
// Un examen agrupado ("COD 0995-1000-...-1418-2023") aporta un código por cada número.
function codesFromText(text) {
  const out = [];
  const re = /COD[\s_]*([\d\s_\-–—/]+?(?:19|20)\d{2})/gi;
  let m;
  while ((m = re.exec(String(text)))) {
    const seg = m[1];
    const year = (seg.match(/((?:19|20)\d{2})/) || [])[1];
    if (!validYear(year)) continue;
    const nums = seg.match(/\d{3,4}/g) || [];
    if (nums.length && nums[nums.length - 1] === year) nums.pop(); // el año no es un código
    for (const num of nums) {
      const code = `${num}-${year}`;
      if (!out.includes(code)) out.push(code);
    }
  }
  return out;
}

function positionName(exam, source, category) {
  if (!/^COD\s/i.test(String(exam)) && exam && !/referencias bibliogr[aá]ficas|p[aá]gina/i.test(exam)) return String(exam).trim();
  const afterDash = String(exam).split(/\s+-\s+/).slice(1).join(' - ').trim();
  if (afterDash && !/referencias bibliogr[aá]ficas|p[aá]gina/i.test(afterDash)) return afterDash;
  if (category && !/referencias bibliogr[aá]ficas|p[aá]gina/i.test(category)) return category;
  return path.basename(source, '.pdf').replace(/_/g, ' ');
}

function careersFromSource(source) {
  const upper = source.toUpperCase();
  const careers = [];
  if (/ARQUITECT/.test(upper)) careers.push('Arquitectura');
  if (/ECONOMIST/.test(upper)) careers.push('Economía');
  if (/ADMINISTRATIV/.test(upper)) careers.push('Administración');
  if (/MEDIC/.test(upper)) careers.push('Medicina');
  if (/SISTEMAS/.test(upper)) careers.push('Ingeniería de Sistemas');
  if (/CONTABILIDAD/.test(upper)) careers.push('Contabilidad'); 
  // Solo se registran carreras explícitamente mencionadas en el nombre del PDF.
  return careers.length ? careers : [NO_VERIFICADA];
}

function yearFromSource(source) {
  const m = String(source).match(/((?:19|20)\d{2})/);
  return m ? validYear(m[1]) : null;
}

const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
const anioByFuente = new Map((bank.examenes || []).map((exam) => [exam.fuente, exam.anio ?? null]));
let perfiles = { metadata: {}, byCodigo: {} };
try {
  perfiles = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'perfiles.json'), 'utf8'));
} catch {
  console.warn('Aviso: no se encontró src/data/perfiles.json; los puestos quedarán sin perfil verificado.');
}
const perfilByCodigo = perfiles.byCodigo || {};
const perfilesGeneradoEn = (perfiles.metadata || {}).generadoEn || '';
const bySource = new Map();
for (const q of bank.preguntas) {
  if (!bySource.has(q.fuente)) bySource.set(q.fuente, []);
  bySource.get(q.fuente).push(q);
}

// Agrega el perfil oficial de cada código; en exámenes agrupados une los lugares
// (el puesto, nivel, carreras y región coinciden; el lugar de prestación varía).
function mergePerfil(codes) {
  const hits = codes.map((c) => perfilByCodigo[c]).filter(Boolean);
  if (!hits.length) return null;
  const niveles = unique(hits.map((h) => h.nivel_educativo));
  const regiones = unique(hits.map((h) => h.region));
  const puestosN = unique(hits.map((h) => h.puesto));
  return {
    codigos_con_perfil: hits.map((h) => h.codigo),
    puesto: puestosN.length === 1 ? puestosN[0] : puestosN.join(' / '),
    nivel_educativo: niveles.length === 1 ? niveles[0] : niveles.join(' / '),
    carreras: unique(hits.flatMap((h) => h.carreras)).sort((a, b) => a.localeCompare(b)),
    carreras_raw: unique(hits.map((h) => h.carreras_raw)).join(' | '),
    region: regiones.length === 1 ? regiones[0] : regiones.join(' / '),
    regiones,
    lugares: unique(hits.flatMap((h) => h.lugares)),
    posiciones: hits.reduce((acc, h) => acc + (h.posiciones || 0), 0) || null,
    remuneracion: unique(hits.map((h) => h.remuneracion).filter(Boolean)).join(' / ') || null,
  };
}

function convocatoriaPorAnio(anio) {
  if (anio === 2023) return 'Concurso Público de Méritos N° 02-2023-CG';
  if (anio === 2022) return 'Concurso Público de Méritos N° 07-2022-CG';
  return 'Concurso Público de Méritos N° 07-2022-CG';
}

const puestos = [...bySource.entries()].map(([source, qs]) => {
  const first = qs[0];
  const codes = unique([...codesFromText(source), ...codesFromText(first.examen)]);
  const nombre = positionName(first.examen, source, first.categoria);
  const id = slug(`${codes.join('-') || nombre}-${source}`);
  const anio = anioByFuente.get(source) ?? yearFromSource(source);
  const perfil = mergePerfil(codes);
  const carreras = perfil && perfil.carreras.length ? perfil.carreras : [NO_VERIFICADA];
  const verificado = Boolean(perfil);
  return {
    id,
    codigo: codes.length ? `COD ${codes[0]}` : 'SIN CODIGO VERIFICADO',
    codigos: codes,
    nombre,
    entidad: 'Contraloría General de la República',
    dependencia: 'No verificada',
    descripcion: nombre,
    carreras,
    carreras_afines: [],
    convocatoria: convocatoriaPorAnio(anio),
    fuente: source,
    fuente_verificacion: source,
    verificado,
    estado_verificacion: verificado
      ? `VERIFICADO contra anexo de consolidado de posiciones (${perfil.codigos_con_perfil.length}/${codes.length} códigos con perfil).`
      : 'NO VERIFICADO: sin match en los anexos de posiciones (balotario o código no encontrado).',
    totalPreguntas: qs.length,
    anio,
    perfil,
  };
});

const carreras = unique(puestos.flatMap((p) => p.carreras)).sort((a, b) => a.localeCompare(b));
const anios = unique(puestos.map((p) => (p.anio ? String(p.anio) : ''))).filter(Boolean).sort((a, b) => Number(b) - Number(a));
const metadata = {
  generadoEn: new Date().toISOString(),
  puestos: puestos.length,
  carreras: carreras.length,
  anios,
  puestosVerificados: puestos.filter((p) => p.verificado).length,
  puestosNoVerificados: puestos.filter((p) => !p.verificado).length,
  perfilesGeneradoEn,
  nota: 'Carreras, nivel educativo, región y lugar de prestación verificados contra los anexos de consolidado de posiciones CPM 02-2023-CG y 07-2022-CG. Sin match (balotarios): se conservan como no verificados, sin inventar datos.',
};

fs.writeFileSync(outPath, JSON.stringify({ metadata, carreras, puestos }, null, 2), 'utf8');
console.log(`Generado ${path.relative(root, outPath)} con ${puestos.length} puestos.`);
