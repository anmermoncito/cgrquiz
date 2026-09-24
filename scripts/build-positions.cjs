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

function codesFromText(text) {
  const matches = String(text).match(/COD[_\s]*(\d{3})(?:-2022)?/gi) || [];
  return unique(matches.map((m) => `COD ${m.match(/\d{3}/)[0]}-2022`));
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
  // Solo se registran carreras explícitamente mencionadas en el nombre del PDF.
  return careers.length ? careers : [NO_VERIFICADA];
}

const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
const bySource = new Map();
for (const q of bank.preguntas) {
  if (!bySource.has(q.fuente)) bySource.set(q.fuente, []);
  bySource.get(q.fuente).push(q);
}

const puestos = [...bySource.entries()].map(([source, qs]) => {
  const first = qs[0];
  const codes = unique([...codesFromText(source), ...codesFromText(first.examen)]);
  const nombre = positionName(first.examen, source, first.categoria);
  const id = slug(`${codes.join('-') || nombre}-${source}`);
  const carreras = careersFromSource(source);
  const verificado = false;
  return {
    id,
    codigo: codes[0] || 'SIN CODIGO VERIFICADO',
    codigos: codes,
    nombre,
    entidad: 'Contraloría General de la República',
    dependencia: 'No verificada',
    descripcion: nombre,
    carreras,
    carreras_afines: [],
    convocatoria: 'Concurso Público de Méritos N° 07-2022-CG',
    fuente: source,
    fuente_verificacion: source,
    verificado,
    estado_verificacion: 'NO VERIFICADO: nombre/código tomado del encabezado o nombre del PDF; carreras no verificadas salvo mención explícita en el archivo.',
    totalPreguntas: qs.length,
  };
});

const carreras = unique(puestos.flatMap((p) => p.carreras)).sort((a, b) => a.localeCompare(b));
const metadata = {
  generadoEn: new Date().toISOString(),
  puestos: puestos.length,
  carreras: carreras.length,
  puestosVerificados: puestos.filter((p) => p.verificado).length,
  puestosNoVerificados: puestos.filter((p) => !p.verificado).length,
  nota: 'No se encontraron fuentes oficiales externas suficientes desde el entorno. No se inventaron carreras ni perfiles: se conservan como no verificados.',
};

fs.writeFileSync(outPath, JSON.stringify({ metadata, carreras, puestos }, null, 2), 'utf8');
console.log(`Generado ${path.relative(root, outPath)} con ${puestos.length} puestos.`);
