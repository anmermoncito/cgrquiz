import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Clock, FilePlus2, RotateCcw, Search, Trash2 } from 'lucide-react';
import banco from './data/examenes.json';
import puestosData from './data/puestos.json';
import { detectCodeAndPosition, extractPdfText, normalizeValue, parseQuestionsFromText, slug } from './pdfImport';
import './styles.css';

type Alternative = { letra: string; texto: string };
type Question = {
  id: string;
  examen: string;
  numero: number;
  pregunta: string;
  alternativas: Alternative[];
  respuesta_correcta: string | null;
  explicacion: string;
  categoria: string;
  fuente: string;
  dificultad: string;
  tipo: string;
};
type Position = {
  id: string;
  codigo: string;
  codigos: string[];
  nombre: string;
  entidad: string;
  fuente: string;
  totalPreguntas: number;
};
type Exam = {
  id: string;
  codigo: string;
  puesto: string;
  categoria: string;
  profesiones: string[];
  archivo_pdf: string;
  fecha_carga: string;
  preguntaIds: string[];
  fuente: string;
  origen: 'base' | 'usuario';
  advertencias?: string[];
};
type DraftExam = {
  id: string;
  archivo_pdf: string;
  codigo: string;
  puesto: string;
  categoria: string;
  profesion: string;
  questions: Question[];
  warnings: string[];
  rawText: string;
};
type Answer = { questionId: string; selected: string; correct: boolean | null; elapsedAt: number };
type Screen = 'home' | 'quiz' | 'results' | 'review';
type AdminMode = 'practice' | 'admin' | 'import';
type StoredCatalog = { exams: Exam[]; customQuestions: Question[]; savedAt: string };

const baseQuestions = banco.preguntas as Question[];
const basePositions = puestosData.puestos as Position[];
const metadata = banco.metadata;
const QUESTION_AMOUNTS = [19, 20, 30, 40, 50, 100, 200];
const CATALOG_KEY = 'quiz-interactivo-catalogo-v2';
const HISTORY_KEY = 'quiz-interactivo-question-history-v2';
const RESULTS_KEY = 'quiz-interactivo-last-result-v2';
const DEFAULT_CATEGORY = 'CONTRALORIA';
const DEFAULT_PROFESSION = 'PROFESION PENDIENTE';

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(seconds / 60).toString().padStart(2, '0');
  const sec = (seconds % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
}

function buildBaseExams(): Exam[] {
  return basePositions.map((position) => {
    const qs = baseQuestions.filter((question) => question.fuente === position.fuente);
    const professions = unique((position as any).carreras?.map((career: string) => normalizeValue(career)).filter((career: string) => !/NO VERIFICADA|PENDIENTE/.test(career)) || []);
    return {
      id: position.id,
      codigo: position.codigo || 'SIN CODIGO VERIFICADO',
      puesto: normalizeValue(position.nombre),
      categoria: DEFAULT_CATEGORY,
      profesiones: professions.length ? professions : [DEFAULT_PROFESSION],
      archivo_pdf: position.fuente,
      fecha_carga: '2026-09-23T00:00:00.000Z',
      preguntaIds: qs.map((question) => question.id),
      fuente: position.fuente,
      origen: 'base',
      advertencias: position.codigo === 'SIN CODIGO VERIFICADO' ? ['Código pendiente de revisión manual.'] : [],
    };
  });
}

function loadCatalog(): { exams: Exam[]; questions: Question[] } {
  const base = buildBaseExams();
  try {
    const stored = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null') as StoredCatalog | null;
    if (stored?.exams?.length) return { exams: stored.exams, questions: [...baseQuestions, ...(stored.customQuestions || [])] };
  } catch {
    // continúa con base
  }
  return { exams: base, questions: baseQuestions };
}

function saveCatalog(exams: Exam[], questions: Question[]) {
  const baseIds = new Set(baseQuestions.map((question) => question.id));
  const customQuestions = questions.filter((question) => !baseIds.has(question.id));
  localStorage.setItem(CATALOG_KEY, JSON.stringify({ exams, customQuestions, savedAt: new Date().toISOString() } satisfies StoredCatalog));
}

function readHistory(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeHistory(history: Record<string, string[]>) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function selectWithoutRecentRepeats(exam: Exam, pool: Question[], amount: number) {
  const uniquePool = [...new Map(pool.map((question) => [question.id, question])).values()];
  if (amount > uniquePool.length) throw new Error(`Este examen tiene ${uniquePool.length} preguntas disponibles.`);
  const history = readHistory();
  const validIds = new Set(uniquePool.map((question) => question.id));
  const used = new Set((history[exam.id] || []).filter((id) => validIds.has(id)));
  const unused = uniquePool.filter((question) => !used.has(question.id));
  const reused = uniquePool.filter((question) => used.has(question.id));
  const selected = unused.length >= amount ? shuffle(unused).slice(0, amount) : [...shuffle(unused), ...shuffle(reused).slice(0, amount - unused.length)];
  const selectedIds = selected.map((question) => question.id);
  const merged = [...new Set([...(history[exam.id] || []).filter((id) => validIds.has(id)), ...selectedIds])];
  history[exam.id] = merged.length >= uniquePool.length ? selectedIds : merged;
  writeHistory(history);
  return selected;
}

function newDraftId() {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `draft-${crypto.randomUUID()}`;
  } catch {
    // continúa con fallback
  }
  return `draft-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function duplicateWarnings(draft: DraftExam, exams: Exam[], questions: Question[]) {
  const warnings: string[] = [];
  const normalizedPosition = normalizeValue(draft.puesto);
  const normalizedCategory = normalizeValue(draft.categoria);
  if (draft.codigo && draft.codigo !== 'SIN CODIGO VERIFICADO' && exams.some((exam) => exam.codigo === draft.codigo)) warnings.push('Ya existe un examen con el mismo código.');
  if (exams.some((exam) => exam.puesto === normalizedPosition && exam.categoria === normalizedCategory)) warnings.push('Ya existe un examen con el mismo puesto y categoría.');
  const existingQuestionTexts = new Set(questions.map((question) => normalizeValue(question.pregunta)));
  const duplicatedQuestions = draft.questions.filter((question) => existingQuestionTexts.has(normalizeValue(question.pregunta))).length;
  if (duplicatedQuestions) warnings.push(`${duplicatedQuestions} preguntas parecen estar duplicadas.`);
  return warnings;
}

function App() {
  const initial = useMemo(loadCatalog, []);
  const [screen, setScreen] = useState<Screen>('home');
  const [mode, setMode] = useState<AdminMode>('practice');
  const [allQuestions, setAllQuestions] = useState<Question[]>(initial.questions);
  const [exams, setExams] = useState<Exam[]>(initial.exams);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(DEFAULT_CATEGORY);
  const [selectedProfession, setSelectedProfession] = useState(DEFAULT_PROFESSION);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [questionAmount, setQuestionAmount] = useState(20);
  const [validation, setValidation] = useState('');
  const [drafts, setDrafts] = useState<DraftExam[]>([]);
  const [importing, setImporting] = useState(false);
  const [adminEditId, setAdminEditId] = useState('');
  const [quizQuestions, setQuizQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [activeExam, setActiveExam] = useState<Exam | null>(null);
  const [activeProfession, setActiveProfession] = useState('');
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => saveCatalog(exams, allQuestions), [exams, allQuestions]);

  const questionById = useMemo(() => new Map(allQuestions.map((question) => [question.id, question])), [allQuestions]);
  const categories = useMemo(() => unique(exams.map((exam) => exam.categoria)).sort(), [exams]);
  const professionsForCategory = useMemo(() => unique(exams.filter((exam) => exam.categoria === selectedCategory).flatMap((exam) => exam.profesiones)).sort(), [exams, selectedCategory]);
  const filteredExams = useMemo(() => exams
    .filter((exam) => exam.categoria === selectedCategory)
    .filter((exam) => exam.profesiones.includes(selectedProfession))
    .filter((exam) => `${exam.codigo} ${exam.puesto} ${exam.archivo_pdf}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.puesto.localeCompare(b.puesto)), [exams, selectedCategory, selectedProfession, query]);
  const selectedExam = filteredExams.find((exam) => exam.id === selectedExamId) || null;
  const availableQuestions = selectedExam ? selectedExam.preguntaIds.map((id) => questionById.get(id)).filter(Boolean) as Question[] : [];
  const activeQuestion = quizQuestions[current];
  const selectedAnswer = activeQuestion ? answers.find((answer) => answer.questionId === activeQuestion.id)?.selected || '' : '';
  const progress = quizQuestions.length ? Math.round(((current + 1) / quizQuestions.length) * 100) : 0;

  useEffect(() => {
    if (!categories.includes(selectedCategory)) setSelectedCategory(categories[0] || DEFAULT_CATEGORY);
  }, [categories, selectedCategory]);

  useEffect(() => {
    if (!professionsForCategory.includes(selectedProfession)) setSelectedProfession(professionsForCategory[0] || DEFAULT_PROFESSION);
  }, [professionsForCategory, selectedProfession]);

  useEffect(() => {
    if (!filteredExams.some((exam) => exam.id === selectedExamId)) setSelectedExamId(filteredExams[0]?.id || '');
  }, [filteredExams, selectedExamId]);

  useEffect(() => {
    if (screen !== 'quiz' || !startedAt || finishedAt) {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    startTimeRef.current = startedAt;
    const updateElapsed = () => {
      if (startTimeRef.current) setElapsedMs(Date.now() - startTimeRef.current);
    };
    updateElapsed();
    timerRef.current = window.setInterval(updateElapsed, 1000);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [screen, startedAt, finishedAt]);

  const validateStart = () => {
    if (!selectedCategory || !categories.includes(selectedCategory)) return 'Selecciona una categoría válida.';
    if (!selectedProfession || !professionsForCategory.includes(selectedProfession)) return 'Selecciona una profesión válida.';
    if (!selectedExam) return 'Selecciona un puesto/examen válido.';
    if (!availableQuestions.length) return 'El banco de preguntas para este examen está vacío.';
    if (questionAmount > availableQuestions.length) return `Este examen tiene ${availableQuestions.length} preguntas disponibles. Selecciona una cantidad igual o menor a ${availableQuestions.length}.`;
    if (new Set(availableQuestions.map((question) => question.id)).size !== availableQuestions.length) return 'Se detectaron preguntas duplicadas por identificador.';
    if (availableQuestions.some((question) => question.alternativas.length < 2)) return 'Hay preguntas sin alternativas suficientes.';
    return '';
  };

  const startPractice = () => {
    const error = validateStart();
    if (error || !selectedExam) {
      setValidation(error || 'No se pudo iniciar la práctica.');
      return;
    }
    try {
      const selected = selectWithoutRecentRepeats(selectedExam, availableQuestions, questionAmount);
      const now = Date.now();
      setQuizQuestions(selected);
      setCurrent(0);
      setAnswers([]);
      setStartedAt(now);
      setFinishedAt(null);
      setElapsedMs(0);
      setActiveExam(selectedExam);
      setActiveProfession(selectedProfession);
      setValidation('');
      setScreen('quiz');
    } catch (error) {
      setValidation(error instanceof Error ? error.message : 'No se pudo seleccionar preguntas.');
    }
  };

  const setAnswer = (letter: string) => {
    if (!activeQuestion) return;
    const correct = activeQuestion.respuesta_correcta ? letter === activeQuestion.respuesta_correcta : null;
    setAnswers((prev) => [...prev.filter((answer) => answer.questionId !== activeQuestion.id), { questionId: activeQuestion.id, selected: letter, correct, elapsedAt: elapsedMs }]);
  };

  const finishQuiz = () => {
    const now = Date.now();
    setFinishedAt(now);
    const finalElapsed = startedAt ? now - startedAt : elapsedMs;
    setElapsedMs(finalElapsed);
    localStorage.setItem(RESULTS_KEY, JSON.stringify({ activeExam, activeProfession, answers, elapsedMs: finalElapsed, finishedAt: new Date().toISOString() }));
    setScreen('results');
  };

  const stats = useMemo(() => {
    const answeredIds = new Set(answers.map((answer) => answer.questionId));
    const correct = answers.filter((answer) => answer.correct === true).length;
    const incorrect = answers.filter((answer) => answer.correct === false).length;
    const pendingKey = answers.filter((answer) => answer.correct === null).length;
    const unanswered = quizQuestions.filter((question) => !answeredIds.has(question.id)).length;
    const percentage = quizQuestions.length ? Math.round((correct / quizQuestions.length) * 100) : 0;
    return { correct, incorrect, pendingKey, unanswered, percentage };
  }, [answers, quizQuestions]);

  const updateExam = (id: string, changes: Partial<Exam>) => {
    setExams((prev) => prev.map((exam) => exam.id === id ? { ...exam, ...changes } : exam));
  };

  const deleteExam = (id: string) => {
    if (!confirm('¿Eliminar este examen del catálogo? Las preguntas base no se borran del archivo original.')) return;
    setExams((prev) => prev.filter((exam) => exam.id !== id));
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setImporting(true);
    const nextDrafts: DraftExam[] = [];
    for (const file of files) {
      try {
        const rawText = await extractPdfText(file);
        const detected = detectCodeAndPosition(rawText, file.name);
        const categoria = DEFAULT_CATEGORY;
        const profesion = DEFAULT_PROFESSION;
        const source = `USUARIO/${file.name}`;
        const examen = `${detected.codigo} - ${detected.puesto}`;
        const parsed = parseQuestionsFromText(rawText, source, examen, categoria) as Question[];
        const draft: DraftExam = {
          id: newDraftId(),
          archivo_pdf: file.name,
          codigo: detected.codigo,
          puesto: detected.puesto,
          categoria,
          profesion,
          questions: parsed,
          warnings: [],
          rawText,
        };
        draft.warnings = duplicateWarnings(draft, exams, allQuestions);
        nextDrafts.push(draft);
      } catch (error) {
        nextDrafts.push({
          id: newDraftId(),
          archivo_pdf: file.name,
          codigo: 'SIN CODIGO VERIFICADO',
          puesto: normalizeValue(file.name.replace(/\.pdf$/i, '')),
          categoria: DEFAULT_CATEGORY,
          profesion: DEFAULT_PROFESSION,
          questions: [],
          warnings: [`No se pudo procesar el PDF: ${error instanceof Error ? error.message : 'error desconocido'}`],
          rawText: '',
        });
      }
    }
    setDrafts((prev) => [...prev, ...nextDrafts]);
    setImporting(false);
    event.target.value = '';
  };

  const updateDraft = (id: string, changes: Partial<DraftExam>) => {
    setDrafts((prev) => prev.map((draft) => {
      if (draft.id !== id) return draft;
      const next = { ...draft, ...changes };
      next.warnings = duplicateWarnings(next, exams, allQuestions);
      return next;
    }));
  };

  const confirmDraft = (draft: DraftExam) => {
    const categoria = normalizeValue(draft.categoria);
    const profesion = normalizeValue(draft.profesion);
    const puesto = normalizeValue(draft.puesto);
    if (!categoria || !profesion || !puesto) {
      alert('Categoría, profesión y puesto son obligatorios.');
      return;
    }
    if (!draft.questions.length) {
      alert('No se pudo realizar una extracción confiable. Revise el documento.');
      return;
    }
    const examId = `user-${slug(`${draft.codigo}-${puesto}-${draft.archivo_pdf}`)}-${Date.now()}`;
    const questions = draft.questions.map((question, index) => ({
      ...question,
      id: `${examId}-q-${index + 1}`,
      examen: `${draft.codigo} - ${puesto}`,
      categoria,
      fuente: `USUARIO/${draft.archivo_pdf}`,
    }));
    const exam: Exam = {
      id: examId,
      codigo: draft.codigo || 'SIN CODIGO VERIFICADO',
      puesto,
      categoria,
      profesiones: [profesion],
      archivo_pdf: draft.archivo_pdf,
      fecha_carga: new Date().toISOString(),
      preguntaIds: questions.map((question) => question.id),
      fuente: `USUARIO/${draft.archivo_pdf}`,
      origen: 'usuario',
      advertencias: draft.warnings,
    };
    setAllQuestions((prev) => [...prev, ...questions]);
    setExams((prev) => [...prev, exam]);
    setDrafts((prev) => prev.filter((item) => item.id !== draft.id));
    setSelectedCategory(categoria);
    setSelectedProfession(profesion);
    setSelectedExamId(examId);
    setMode('practice');
  };

  const allAdminExams = useMemo(() => exams.filter((exam) => `${exam.categoria} ${exam.profesiones.join(' ')} ${exam.codigo} ${exam.puesto} ${exam.archivo_pdf}`.toLowerCase().includes(query.toLowerCase())), [exams, query]);

  if (screen === 'quiz' && activeQuestion) {
    return <main className="shell quiz-shell">
      <button className="ghost" onClick={() => setScreen('home')}><ArrowLeft size={18} /> Volver</button>
      <section className="quiz-card" aria-live="polite">
        <div className="quiz-topline">
          <div>
            <p className="eyebrow">{activeExam?.categoria} · {activeProfession}</p>
            <h1>{activeExam?.puesto}</h1>
            <p className="source">Código: {activeExam?.codigo} · PDF: {activeExam?.archivo_pdf}</p>
          </div>
          <span className="pill"><Clock size={16} /> Tiempo: {formatTime(elapsedMs)}</span>
        </div>
        <div className="progress-label"><strong>Pregunta {current + 1} de {quizQuestions.length}</strong><span>{progress}%</span></div>
        <div className="progress"><span style={{ width: `${progress}%` }} /></div>
        <p className="source">N.º original {activeQuestion.numero} · Origen: {activeQuestion.fuente}</p>
        <h2 className="question-text">{activeQuestion.pregunta}</h2>
        <fieldset className="options">
          <legend className="sr-only">Alternativas</legend>
          {activeQuestion.alternativas.map((option) => <label key={option.letra} className={`option ${selectedAnswer === option.letra ? 'selected' : ''}`}>
            <input type="radio" name={`answer-${activeQuestion.id}`} value={option.letra} checked={selectedAnswer === option.letra} onChange={() => setAnswer(option.letra)} />
            <span className="letter">{option.letra}</span>
            <span>{option.texto}</span>
          </label>)}
        </fieldset>
        {!activeQuestion.respuesta_correcta && <p className="warning">Esta pregunta no tiene respuesta correcta identificada en el PDF.</p>}
        <div className="actions">
          <button className="secondary" onClick={() => setCurrent((value) => Math.max(0, value - 1))} disabled={current === 0}>Anterior</button>
          {current + 1 < quizQuestions.length ? <button className="primary" onClick={() => setCurrent((value) => Math.min(quizQuestions.length - 1, value + 1))}>Siguiente</button> : <button className="primary" onClick={finishQuiz}>Finalizar</button>}
          {current + 1 < quizQuestions.length && <button className="ghost" onClick={finishQuiz}>Finalizar ahora</button>}
        </div>
      </section>
    </main>;
  }

  if (screen === 'results') {
    return <main className="shell">
      <section className="hero results">
        <p className="eyebrow">Resultado</p>
        <h1>🎯 {stats.correct} / {quizQuestions.length} correctas</h1>
        <div className="score-circle">{stats.percentage}%</div>
        <div className="stats-grid">
          <span>Categoría <strong>{activeExam?.categoria}</strong></span>
          <span>Profesión <strong>{activeProfession}</strong></span>
          <span>Puesto <strong>{activeExam?.puesto}</strong></span>
          <span>Código <strong>{activeExam?.codigo}</strong></span>
          <span>Preguntas <strong>{quizQuestions.length}</strong></span>
          <span>Correctas <strong>{stats.correct}</strong></span>
          <span>Incorrectas <strong>{stats.incorrect}</strong></span>
          <span>Sin responder <strong>{stats.unanswered}</strong></span>
          <span>Sin clave <strong>{stats.pendingKey}</strong></span>
          <span>Tiempo <strong>{formatTime(elapsedMs)}</strong></span>
        </div>
        <div className="actions center">
          <button className="primary" onClick={() => setScreen('review')}>Ver respuestas</button>
          <button className="secondary" onClick={startPractice}><RotateCcw size={18} /> Nueva práctica</button>
          <button className="ghost" onClick={() => setScreen('home')}>Volver al inicio</button>
        </div>
      </section>
    </main>;
  }

  if (screen === 'review') {
    return <main className="shell">
      <button className="ghost" onClick={() => setScreen('results')}><ArrowLeft size={18} /> Resultados</button>
      <h1>Revisión de respuestas</h1>
      <div className="review-list">
        {quizQuestions.map((question, index) => {
          const answer = answers.find((item) => item.questionId === question.id);
          return <article className="review-card" key={question.id}>
            <p className="eyebrow">Pregunta {index + 1} · {activeExam?.codigo} · {activeExam?.puesto}</p>
            <h2>{question.pregunta}</h2>
            <p><strong>Tu respuesta:</strong> {answer ? `${answer.selected}) ${question.alternativas.find((alt) => alt.letra === answer.selected)?.texto}` : 'No respondida'}</p>
            <p><strong>Respuesta correcta:</strong> {question.respuesta_correcta ? `${question.respuesta_correcta}) ${question.alternativas.find((alt) => alt.letra === question.respuesta_correcta)?.texto}` : 'Pendiente de configuración'}</p>
            <p className={answer?.correct ? 'text-ok' : answer?.correct === false ? 'text-bad' : 'text-pending'}><strong>Estado:</strong> {answer?.correct === true ? 'Correcta' : answer?.correct === false ? 'Incorrecta' : answer ? 'Sin clave identificada' : 'Sin responder'}</p>
            {question.explicacion && <p><strong>Explicación / referencia:</strong> {question.explicacion}</p>}
          </article>;
        })}
      </div>
    </main>;
  }

  return <main className="shell">
    <section className="hero">
      <div>
        <p className="eyebrow">Quiz interactivo desde PDFs reales</p>
        <h1>Exámenes por categoría, profesión y puesto</h1>
        <p>Administra PDFs, corrige metadatos y practica con preguntas aleatorias sin duplicados.</p>
      </div>
      <div className="metadata-card">
        <strong>{allQuestions.length.toLocaleString('es-PE')}</strong><span>preguntas disponibles</span>
        <strong>{exams.length}</strong><span>exámenes cargados</span>
        <strong>{categories.length}</strong><span>categorías</span>
      </div>
    </section>

    <div className="mode-tabs">
      <button className={mode === 'practice' ? 'primary' : 'secondary'} onClick={() => setMode('practice')}>Practicar</button>
      <button className={mode === 'admin' ? 'primary' : 'secondary'} onClick={() => setMode('admin')}>Administración</button>
      <button className={mode === 'import' ? 'primary' : 'secondary'} onClick={() => setMode('import')}><FilePlus2 size={18} /> Agregar examen PDF</button>
    </div>

    {mode === 'practice' && <>
      <section className="toolbar setup" aria-label="Configuración de práctica">
        <label><span>Categoría</span><select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label><span>Profesión</span><select value={selectedProfession} onChange={(event) => setSelectedProfession(event.target.value)}>{professionsForCategory.map((profession) => <option key={profession}>{profession}</option>)}</select></label>
        <label><span>Puesto</span><select value={selectedExamId} onChange={(event) => setSelectedExamId(event.target.value)}>{filteredExams.map((exam) => <option value={exam.id} key={exam.id}>{exam.puesto} ({exam.preguntaIds.length})</option>)}</select></label>
        <label className="search"><span>Buscar</span><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="COD, puesto, PDF..." /></label>
      </section>
      <section className="exam-card setup-card">
        <p className="eyebrow">Número de preguntas</p>
        <div className="amount-grid">{QUESTION_AMOUNTS.map((amount) => <button key={amount} className={questionAmount === amount ? 'primary' : 'secondary'} onClick={() => setQuestionAmount(amount)}>{amount}</button>)}</div>
        {selectedExam && <div className="position-summary">
          <h2>{selectedExam.puesto}</h2>
          <p><strong>Categoría:</strong> {selectedExam.categoria}</p>
          <p><strong>Profesión:</strong> {selectedProfession}</p>
          <p><strong>Código:</strong> {selectedExam.codigo}</p>
          <p><strong>PDF:</strong> {selectedExam.archivo_pdf}</p>
          <p><strong>Banco disponible:</strong> {availableQuestions.length} preguntas</p>
          {!!selectedExam.advertencias?.length && <p className="warning">{selectedExam.advertencias.join(' ')}</p>}
        </div>}
        {validation && <p className="warning" role="alert">{validation}</p>}
        <button className="primary start-button" onClick={startPractice}>Iniciar práctica</button>
      </section>
    </>}

    {mode === 'import' && <section className="exam-card setup-card">
      <p className="eyebrow">Agregar nuevo examen</p>
      <h2>Subir PDF</h2>
      <label className="upload-box"><FilePlus2 /> + Agregar examen PDF<input type="file" accept="application/pdf" multiple onChange={handleFiles} /></label>
      {importing && <p className="warning">Analizando PDF...</p>}
      <div className="review-list import-list">
        {drafts.map((draft) => <article className="review-card" key={draft.id}>
          <p className="eyebrow">Nuevo examen · {draft.archivo_pdf}</p>
          <div className="form-grid">
            <label><span>Código detectado</span><input value={draft.codigo} onChange={(event) => updateDraft(draft.id, { codigo: event.target.value })} /></label>
            <label><span>Puesto detectado / editable</span><input value={draft.puesto} onChange={(event) => updateDraft(draft.id, { puesto: event.target.value })} /></label>
            <label><span>Categoría</span><input list="category-list" value={draft.categoria} onChange={(event) => updateDraft(draft.id, { categoria: normalizeValue(event.target.value) })} placeholder="CONTRALORIA" /></label>
            <label><span>Profesión</span><input list="profession-list" value={draft.profesion} onChange={(event) => updateDraft(draft.id, { profesion: normalizeValue(event.target.value) })} placeholder="CONTABILIDAD" /></label>
          </div>
          <datalist id="category-list">{categories.map((category) => <option key={category} value={category} />)}</datalist>
          <datalist id="profession-list">{unique(exams.flatMap((exam) => exam.profesiones)).map((profession) => <option key={profession} value={profession} />)}</datalist>
          <p><strong>Preguntas detectadas:</strong> {draft.questions.length}</p>
          <p><strong>Con respuesta detectada:</strong> {draft.questions.filter((q) => q.respuesta_correcta).length} · <strong>Sin respuesta:</strong> {draft.questions.filter((q) => !q.respuesta_correcta).length}</p>
          {!draft.questions.length && <p className="warning" role="alert">No se pudo realizar una extracción confiable. Revise el documento: no se encontraron estructuras de pregunta (número + alternativas). No se guardará un examen vacío.</p>}
          {!!draft.questions.length && <div className="import-preview">
            {draft.questions.map((q, qi) => <article className="import-preview-item" key={`${draft.id}-q-${qi}`}>
              <p><strong>Pregunta {q.numero}</strong> · {q.pregunta}</p>
              <ul>{q.alternativas.map((alt, ai) => <li key={ai}>{alt.letra}) {alt.texto}{q.respuesta_correcta === alt.letra ? ' ✓' : ''}</li>)}</ul>
              {!!q.explicacion && <p className="source">Solución: {q.explicacion.slice(0, 220)}{q.explicacion.length > 220 ? '…' : ''}</p>}
            </article>)}
          </div>}
          {!!draft.warnings.length && <p className="warning">{draft.warnings.join(' ')}</p>}
          <div className="actions"><button className="primary" onClick={() => confirmDraft(draft)} disabled={!draft.questions.length}>Confirmar importación</button><button className="ghost" onClick={() => setDrafts((prev) => prev.filter((item) => item.id !== draft.id))}>Cancelar</button></div>
        </article>)}
      </div>
    </section>}

    {mode === 'admin' && <section className="exam-card setup-card">
      <div className="quiz-topline"><div><p className="eyebrow">Administración</p><h2>Exámenes cargados</h2></div><label className="search admin-search"><span>Buscar</span><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Categoría, profesión, código, puesto..." /></label></div>
      <div className="admin-table">
        <div className="admin-row admin-head"><span>Categoría</span><span>Código</span><span>Puesto</span><span>Profesión</span><span>Preguntas</span><span>Acciones</span></div>
        {allAdminExams.map((exam) => <div className="admin-row" key={exam.id}>
          {adminEditId === exam.id ? <>
            <input value={exam.categoria} onChange={(event) => updateExam(exam.id, { categoria: normalizeValue(event.target.value) })} />
            <input value={exam.codigo} onChange={(event) => updateExam(exam.id, { codigo: event.target.value })} />
            <input value={exam.puesto} onChange={(event) => updateExam(exam.id, { puesto: normalizeValue(event.target.value) })} />
            <input value={exam.profesiones.join(', ')} onChange={(event) => { const next = unique(event.target.value.split(',').map(normalizeValue)); updateExam(exam.id, { profesiones: next.length ? next : [DEFAULT_PROFESSION] }); }} />
            <span>{exam.preguntaIds.length}</span>
            <span><button className="primary" onClick={() => setAdminEditId('')}>Guardar</button></span>
          </> : <>
            <span>{exam.categoria}</span><span>{exam.codigo}</span><span>{exam.puesto}</span><span>{exam.profesiones.join(', ')}</span><span>{exam.preguntaIds.length}</span>
            <span className="row-actions"><button className="secondary" onClick={() => setAdminEditId(exam.id)}>Editar</button><button className="ghost" onClick={() => deleteExam(exam.id)}><Trash2 size={16} /> Eliminar</button></span>
          </>}
        </div>)}
      </div>
    </section>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
