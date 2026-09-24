const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const root = process.cwd();
const pdfDir = path.join(root, 'EXAMENES');
const outDir = path.join(root, 'src', 'data');
const outFile = process.env.PDF_OUT || path.join(outDir, 'examenes.json');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.toLowerCase().endsWith('.pdf') ? [full] : [];
  });
}

function cleanText(text) {
  return text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

function normalizeLine(line) {
  return line
    .replace(/[•●]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function isNoise(line) {
  return (
    !line ||
    /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line) ||
    /^Universidad Nacional Mayor de San Marcos$/i.test(line) ||
    /^OFICINA CENTRAL DE ADMISIÓN$/i.test(line) ||
    /^Prueba de Conocimientos del Concurso Público/i.test(line) ||
    /^Referencias bibliográficas\s*[–-]/i.test(line) ||
    /^COD\s+\d+/i.test(line) ||
    /^Página\s+\d+$/i.test(line)
  );
}

function titleFrom(text, filename) {
  const lines = text.split('\n').map(normalizeLine).filter(Boolean);
  const balotario = lines.find((l) => /^BALOTARIO/i.test(l));
  if (balotario) return balotario;
  const cod = lines.find((l) => /^COD\s+\d+/i.test(l));
  const afterCod = cod ? lines[lines.indexOf(cod) + 1] : '';
  return [cod, afterCod].filter(Boolean).join(' - ') || path.basename(filename, '.pdf');
}

function inferCategory(title, category) {
  if (category) return category;
  const parts = title.split(' - ');
  return parts[1] || parts[0] || 'General';
}

function hasStarMark(value) {
  return /(^|[^0-9A-Za-zÀ-ÿ])[*✓]|[*✓]([^0-9A-Za-zÀ-ÿ]|$)/.test(String(value || ''));
}

function stripStarMarks(value) {
  return String(value || '')
    .replace(/(^|[^0-9A-Za-zÀ-ÿ])[*✓]+/g, '$1')
    .replace(/[*✓]+([^0-9A-Za-zÀ-ÿ]|$)/g, '$1');
}

function compact(value) {
  return normalizeLine(stripStarMarks(value || ''));
}

function isPageHeader(line) {
  return (
    /^Concurso P[uú]blico de M[eé]ritos/i.test(line) ||
    /^PRUEBA DE APTITUD/i.test(line) ||
    /^Solucionario(\s+P[aá]gina.*)?$/i.test(line) ||
    /^COMPRENSI[OÓ]N LECTORA$/i.test(line) ||
    /^TEXTO$/i.test(line) ||
    /^INSTRUCCIONES$/i.test(line)
  );
}

function normalizeValue(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ñ/g, 'N')
    .replace(/ñ/g, 'n')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isTitleEcho(line, examen) {
  if (/^COD\s*\d+/i.test(line)) return true;
  const norm = normalizeValue(line);
  if (norm.length < 10) return false;
  const parts = String(examen)
    .split(' - ')
    .map((p) => normalizeValue(p))
    .filter((p) => p.length >= 10);
  return parts.includes(norm);
}

function isQuestionDecimal(line) {
  return /^\d{1,3}[.)]\d/.test(line);
}

const QUESTION_RE = /^(?:PREGUNTA\s*)?(\d{1,3})\s*[.)]\s*(.*)$/i;
const OPTION_RE = /^([A-E])\s*[).\-]\s*(.*)$/i;
const SOLUTION_RE = /^(SOLUCI[OÓ]N|EXPLICACI[OÓ]N)\s*:(.*)$/i;

function splitInlineOptions(line) {
  const re = /(^|\s)([A-E])\)\s*/g;
  const matches = [...line.matchAll(re)];
  if (!matches.length) return { head: line, opts: [] };
  const head = line.slice(0, matches[0].index).trim();
  const opts = matches.map((m, i) => {
    const segStart = m.index + m[0].length;
    const segEnd = i + 1 < matches.length ? matches[i + 1].index : line.length;
    return { letra: m[2], texto: line.slice(segStart, segEnd).trim() };
  });
  return { head, opts };
}

function parseQuestions(text, file) {
  const source = path.relative(root, file).replace(/\\/g, '/');
  const examen = titleFrom(text, file);
  const lines = cleanText(text).split('\n').map(normalizeLine).filter((l) => !isNoise(l) && !isPageHeader(l) && !isTitleEcho(l, examen));
  const questions = [];
  let current = null;
  let lastOption = null;
  let inExplanation = false;
  let category = '';

  const push = () => {
    if (!current) return;
    current.pregunta = compact(current.pregunta);
    current.explicacion = compact(current.explicacion);
    current.alternativas = current.alternativas.map((a) => ({ ...a, texto: compact(a.texto) }));
    if (current.pregunta && current.alternativas.length >= 2) questions.push(current);
  };

  const addOption = (letra, rawTexto) => {
    if (hasStarMark(rawTexto) && !current.respuesta_correcta) current.respuesta_correcta = letra;
    current.alternativas.push({ letra, texto: normalizeLine(rawTexto) });
    lastOption = current.alternativas[current.alternativas.length - 1];
  };

  for (const line of lines) {
    const cat = line.match(/^(BLOQUE\s+[IVXLCDM]+\s*[:.-].+|CONOCIMIENTOS\s+.+|RAZONAMIENTO\s+.+)$/i);
    if (cat) {
      category = line;
      continue;
    }

    const q = line.match(QUESTION_RE);
    if (q && !isQuestionDecimal(line)) {
      push();
      current = {
        id: '',
        examen,
        numero: Number(q[1]),
        pregunta: '',
        alternativas: [],
        respuesta_correcta: null,
        explicacion: '',
        categoria: inferCategory(examen, category),
        fuente: source,
        dificultad: 'media',
        tipo: 'opcion_multiple',
      };
      lastOption = null;
      inExplanation = false;
      const parts = splitInlineOptions(q[2]);
      if (!parts.opts.length) {
        const om = q[2].match(OPTION_RE);
        if (om) addOption(om[1].toUpperCase(), om[2]);
        else current.pregunta = q[2];
      } else {
        current.pregunta = parts.head;
        parts.opts.forEach((o) => addOption(o.letra, o.texto));
      }
      continue;
    }

    if (!current) continue;

    const answer = line.match(/^RESPUESTA\s*[:.-]\s*([A-E])\b/i);
    if (answer) {
      current.respuesta_correcta = answer[1].toUpperCase();
      inExplanation = true;
      const rest = line.replace(/^RESPUESTA\s*[:.-]\s*[A-E]\b\s*/i, '');
      if (rest) current.explicacion += ` ${rest}`;
      continue;
    }

    const ref = line.match(/^Referencia bibliográfica\s*[:.-]\s*(.*)$/i);
    if (ref) {
      inExplanation = true;
      current.explicacion += `Referencia bibliográfica: ${ref[1]}`;
      continue;
    }

    const sol = line.match(SOLUTION_RE);
    if (sol) {
      inExplanation = true;
      if (sol[2].trim()) current.explicacion += ` ${sol[2].trim()}`;
      continue;
    }

    if (inExplanation) {
      current.explicacion += ` ${line}`;
      continue;
    }

    const parts = splitInlineOptions(line);
    if (!parts.opts.length) {
      const om = line.match(OPTION_RE);
      if (om) {
        addOption(om[1].toUpperCase(), om[2]);
        inExplanation = false;
        continue;
      }
    } else {
      if (parts.head) {
        if (lastOption) {
          if (hasStarMark(parts.head) && !current.respuesta_correcta) current.respuesta_correcta = lastOption.letra;
          lastOption.texto += ` ${parts.head}`;
        } else {
          current.pregunta += ` ${parts.head}`;
        }
      }
      parts.opts.forEach((o) => addOption(o.letra, o.texto));
      inExplanation = false;
      continue;
    }

    if (/^\*+$/.test(line)) {
      if (lastOption && !current.respuesta_correcta) current.respuesta_correcta = lastOption.letra;
      continue;
    }

    if (lastOption) {
      if (hasStarMark(line) && !current.respuesta_correcta) current.respuesta_correcta = lastOption.letra;
      lastOption.texto += ` ${line}`;
    } else {
      current.pregunta += ` ${line}`;
    }
  }
  push();
  return questions;
}

(async () => {
  const files = walk(pdfDir).sort((a, b) => a.localeCompare(b));
  const all = [];
  const pdfs = [];
  for (const file of files) {
    try {
      const parser = new PDFParse({ data: fs.readFileSync(file) });
      const result = await parser.getText();
      await parser.destroy();
      const parsed = parseQuestions(result.text, file);
      pdfs.push({ fuente: path.relative(root, file).replace(/\\/g, '/'), preguntas: parsed.length });
      all.push(...parsed);
      console.log(`${path.basename(file)}: ${parsed.length} preguntas`);
    } catch (error) {
      pdfs.push({ fuente: path.relative(root, file).replace(/\\/g, '/'), preguntas: 0, error: error.message });
      console.warn(`No se pudo procesar ${file}: ${error.message}`);
    }
  }

  const questions = all.map((q, index) => ({ ...q, id: `q-${index + 1}` }));
  const exams = [...new Map(questions.map((q) => [q.examen, q])).values()].map((q) => ({
    id: q.examen.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, ''),
    nombre: q.examen,
    fuente: q.fuente,
    categoria: q.categoria,
    totalPreguntas: questions.filter((item) => item.examen === q.examen).length,
  }));
  const metadata = {
    generadoEn: new Date().toISOString(),
    pdfsEncontrados: files.length,
    pdfs,
    examenes: exams.length,
    preguntas: questions.length,
    conRespuesta: questions.filter((q) => q.respuesta_correcta).length,
    sinRespuesta: questions.filter((q) => !q.respuesta_correcta).length,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ metadata, examenes: exams, preguntas: questions }, null, 2), 'utf8');
  console.log(`\nGenerado ${path.relative(root, outFile)} con ${questions.length} preguntas.`);
})();
