import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type ImportedAlternative = { letra: string; texto: string };
export type ImportedQuestion = {
  id: string;
  examen: string;
  numero: number;
  pregunta: string;
  alternativas: ImportedAlternative[];
  respuesta_correcta: string | null;
  explicacion: string;
  categoria: string;
  fuente: string;
  dificultad: string;
  tipo: string;
};

export function normalizeValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ñ/g, 'N')
    .replace(/ñ/g, 'n')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function slug(value: string) {
  return normalizeValue(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeLine(line: string) {
  return line.replace(/[•●]/g, '').replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

function hasStarMark(value: string) {
  return /(^|[^0-9A-Za-zÀ-ÿ])[*✓]|[*✓]([^0-9A-Za-zÀ-ÿ]|$)/.test(String(value || ''));
}

function stripStarMarks(value: string) {
  return String(value || '')
    .replace(/(^|[^0-9A-Za-zÀ-ÿ])[*✓]+/g, '$1')
    .replace(/[*✓]+([^0-9A-Za-zÀ-ÿ]|$)/g, '$1');
}

function cleanField(value: string) {
  return normalizeLine(stripStarMarks(value || ''));
}

function isNoise(line: string) {
  return (
    !line ||
    /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line) ||
    /^Universidad Nacional Mayor de San Marcos$/i.test(line) ||
    /^OFICINA CENTRAL DE ADMISIÓN$/i.test(line) ||
    /^Prueba de Conocimientos del Concurso Público/i.test(line) ||
    /^Referencias bibliográficas\s*[–-]/i.test(line) ||
    /^Página\s+\d+$/i.test(line)
  );
}

function isPageHeader(line: string) {
  return (
    /^Concurso P[uú]blico de M[eé]ritos/i.test(line) ||
    /^PRUEBA DE APTITUD/i.test(line) ||
    /^Solucionario(\s+P[aá]gina.*)?$/i.test(line) ||
    /^COMPRENSI[OÓ]N LECTORA$/i.test(line) ||
    /^TEXTO$/i.test(line) ||
    /^INSTRUCCIONES$/i.test(line)
  );
}

function isTitleEcho(line: string, examen: string) {
  if (/^COD\s*\d+/i.test(line)) return true;
  const norm = normalizeValue(line);
  if (norm.length < 10) return false;
  const parts = String(examen)
    .split(' - ')
    .map((p) => normalizeValue(p))
    .filter((p) => p.length >= 10);
  return parts.includes(norm);
}

function isQuestionDecimal(line: string) {
  return /^\d{1,3}[.)]\d/.test(line);
}

type PdfTextItem = { str?: unknown; hasEOL?: boolean; transform?: unknown };

function reconstructPageLines(items: unknown[]) {
  const textItems = (items as PdfTextItem[]).filter((it) => it && typeof it.str === 'string');
  if (textItems.some((it) => it.hasEOL === true)) {
    const lines: string[] = [];
    let current = '';
    for (const it of textItems) {
      const s = it.str as string;
      if (!s) {
        if (it.hasEOL) {
          lines.push(current);
          current = '';
        }
        continue;
      }
      if (current && !/\s$/.test(current) && !/^\s/.test(s)) current += ' ';
      current += s;
      if (it.hasEOL) {
        lines.push(current);
        current = '';
      }
    }
    if (current.trim()) lines.push(current);
    return lines.join('\n');
  }
  const placed = textItems
    .map((it) => ({
      x: Array.isArray(it.transform) ? (it.transform[4] as number) : 0,
      y: Array.isArray(it.transform) ? (it.transform[5] as number) : 0,
      str: it.str as string,
    }))
    .filter((it) => it.str.trim());
  placed.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; parts: { x: number; str: string }[] }[] = [];
  for (const it of placed) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 2);
    if (row) row.parts.push({ x: it.x, str: it.str });
    else rows.push({ y: it.y, parts: [{ x: it.x, str: it.str }] });
  }
  return rows
    .map((r) =>
      r.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join('\n');
}

export async function extractPdfText(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(reconstructPageLines(content.items));
  }
  await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  return pages.join('\n');
}

export function detectCodeAndPosition(text: string, fallbackName: string) {
  const lines = text.split('\n').map(normalizeLine).filter((line) => line && !isNoise(line));
  const codeIndex = lines.findIndex((line) => /^COD\s*\d{2,4}(?:\s*-\s*\d{4})?/i.test(line));
  if (codeIndex >= 0) {
    const codeMatch = lines[codeIndex].match(/COD\s*(\d{2,4})(?:\s*-\s*(\d{4}))?/i);
    const codigo = codeMatch ? `COD ${codeMatch[1]}${codeMatch[2] ? `-${codeMatch[2]}` : ''}` : lines[codeIndex];
    const sameLineRest = lines[codeIndex].replace(/^COD\s*\d{2,4}(?:\s*-\s*\d{4})?\s*[-/:]?\s*/i, '').trim();
    const next = lines.slice(codeIndex + 1).find((line) => !/^COD\s/i.test(line) && !/^Referencias bibliogr/i.test(line));
    const puesto = sameLineRest || next || fallbackName.replace(/\.pdf$/i, '');
    return { codigo, puesto: normalizeValue(puesto) };
  }
  const title = lines.find((line) => /^(PRUEBA|EXAMEN|EVALUACI[OÓ]N|CUESTIONARIO|BANCO DE PREGUNTAS)\b.*$/i.test(line));
  const puesto = title || fallbackName.replace(/\.pdf$/i, '');
  return { codigo: 'SIN CODIGO VERIFICADO', puesto: normalizeValue(puesto) };
}

const QUESTION_RE = /^(?:PREGUNTA\s*)?(\d{1,3})\s*[.)]\s*(.*)$/i;
const OPTION_RE = /^([A-E])\s*[).\-]\s*(.*)$/i;
const SOLUTION_RE = /^(SOLUCI[OÓ]N|EXPLICACI[OÓ]N)\s*:(.*)$/i;
const ANSWER_KEY_RE = /^RESPUESTA\s*[:.-]\s*([A-E])\b/i;
const REFERENCE_RE = /^Referencia bibliográfica\s*[:.-]\s*(.*)$/i;

function splitInlineOptions(line: string) {
  const re = /(^|\s)([A-E])\)\s*/g;
  const matches = [...line.matchAll(re)];
  if (!matches.length) return { head: line, opts: [] as { letra: string; texto: string }[] };
  const head = line.slice(0, matches[0].index).trim();
  const opts = matches.map((m, i) => {
    const segStart = (m.index as number) + m[0].length;
    const segEnd = i + 1 < matches.length ? (matches[i + 1].index as number) : line.length;
    return { letra: m[2], texto: line.slice(segStart, segEnd).trim() };
  });
  return { head, opts };
}

export function parseQuestionsFromText(text: string, source: string, examen: string, categoria: string): ImportedQuestion[] {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(normalizeLine)
    .filter((line) => !isNoise(line) && !isPageHeader(line) && !isTitleEcho(line, examen));
  const questions: ImportedQuestion[] = [];
  let current: ImportedQuestion | null = null;
  let lastOption: ImportedAlternative | null = null;
  let inExplanation = false;

  const push = () => {
    if (!current) return;
    current.pregunta = cleanField(current.pregunta);
    current.explicacion = cleanField(current.explicacion);
    current.alternativas = current.alternativas.map((alt) => ({ ...alt, texto: cleanField(alt.texto) }));
    if (current.pregunta && current.alternativas.length >= 2) questions.push(current);
  };

  const addOption = (letra: string, rawTexto: string): ImportedAlternative | null => {
    if (!current) return null;
    if (hasStarMark(rawTexto) && !current.respuesta_correcta) current.respuesta_correcta = letra;
    const option: ImportedAlternative = { letra, texto: normalizeLine(rawTexto) };
    current.alternativas.push(option);
    return option;
  };

  for (const line of lines) {
    const qm = line.match(QUESTION_RE);
    if (qm && !isQuestionDecimal(line)) {
      push();
      current = {
        id: '',
        examen,
        numero: Number(qm[1]),
        pregunta: '',
        alternativas: [],
        respuesta_correcta: null,
        explicacion: '',
        categoria,
        fuente: source,
        dificultad: 'media',
        tipo: 'opcion_multiple',
      };
      lastOption = null;
      inExplanation = false;
      const parts = splitInlineOptions(qm[2]);
      if (!parts.opts.length) {
        const om = qm[2].match(OPTION_RE);
        if (om) lastOption = addOption(om[1].toUpperCase(), om[2]);
        else current.pregunta = qm[2];
      } else {
        current.pregunta = parts.head;
        for (const o of parts.opts) lastOption = addOption(o.letra, o.texto);
      }
      continue;
    }

    if (!current) continue;

    const rm = line.match(ANSWER_KEY_RE);
    if (rm) {
      current.respuesta_correcta = rm[1].toUpperCase();
      inExplanation = true;
      const rest = line.replace(ANSWER_KEY_RE, '').trim();
      if (rest) current.explicacion += ` ${rest}`;
      continue;
    }

    const rf = line.match(REFERENCE_RE);
    if (rf) {
      inExplanation = true;
      current.explicacion += ` Referencia bibliográfica: ${rf[1]}`;
      continue;
    }

    const sm = line.match(SOLUTION_RE);
    if (sm) {
      inExplanation = true;
      if (sm[2].trim()) current.explicacion += ` ${sm[2].trim()}`;
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
        lastOption = addOption(om[1].toUpperCase(), om[2]);
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
      for (const o of parts.opts) lastOption = addOption(o.letra, o.texto);
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

  return questions.map((question, index) => ({ ...question, id: `import-${Date.now()}-${index + 1}` }));
}
