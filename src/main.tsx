import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Clock, Download, FilePlus2, RotateCcw, Search, Trash2 } from 'lucide-react';
import banco from './data/examenes.json';
import puestosData from './data/puestos.json';
import perfilesData from './data/perfiles.json';
import { csvFileName, exportCsv } from './csvExport';
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
  grupo_id?: string;
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
  anio: number | null;
  grupo_id?: string;
  perfil: {
    puesto: string;
    nivel_educativo: string;
    carreras: string[];
    carreras_raw: string;
    region: string;
    regiones: string[];
    lugares: string[];
    posiciones: number | null;
    remuneracion: string | null;
  } | null;
};
type Exam = {
  id: string;
  codigo: string;
  codigos: string[];
  puesto: string;
  categoria: string;
  archivo_pdf: string;
  fecha_carga: string;
  preguntaIds: string[];
  fuente: string;
  origen: 'base' | 'usuario';
  anio: number | null;
  nivel_educativo: string | null;
  carreras: string[];
  carreras_raw: string | null;
  region: string | null;
  regiones: string[];
  lugares: string[];
  posiciones: number | null;
  remuneracion: string | null;
  perfilVerificado: boolean;
  advertencias?: string[];
};
type DraftExam = {
  id: string;
  archivo_pdf: string;
  codigo: string;
  codigos: string[];
  puesto: string;
  categoria: string;
  carrera: string;
  anio: number | null;
  nivel_educativo: string | null;
  region: string | null;
  lugar_prestacion: string;
  questions: Question[];
  warnings: string[];
  rawText: string;
};
type Answer = { questionId: string; selected: string; correct: boolean | null; elapsedAt: number };
type Screen = 'home' | 'quiz' | 'results' | 'review';
type AdminMode = 'practice' | 'admin' | 'import' | 'plazas' | 'aptitud' | 'conocimientos' | 'curricular' | 'consolidado';
type Perfil2026 = {
  cod_perfil: string; categoria_remunerativa: string; unidad_organizacion: string;
  nombre_puesto: string; numero_posiciones: number; lugar_prestacion: string;
  remuneracion: string | null;
};
type Postulante2026 = {
  numero: number; tipo_doc: string; numero_documento: string;
  apellidos_nombres: string; numero_perfil: string; condicion: string;
};
type PlazasData = {
  perfiles: Perfil2026[]; postulantes: Postulante2026[];
  unidades: string[]; lugares: string[];
};

// N° de perfil del código ("404 - 2026" -> "404") para relacionarlo con
// N° PERFIL del postulante ("404"), sin modificar los datos originales.
function clavePerfil(cod: string | number | null | undefined) {
  const m = String(cod ?? '').match(/^\s*(\d+)/);
  return m ? m[1] : '';
}

function Paginador({ total, pageSize, page, onSize, onPage }: {
  total: number; pageSize: number; page: number;
  onSize: (n: number) => void; onPage: (n: number) => void;
}) {  const paginas = Math.max(1, Math.ceil(total / pageSize));
  const actual = Math.min(Math.max(1, page), paginas);
  const nums: (number | '…')[] = [];
  for (let n = 1; n <= paginas; n++) {
    if (n === 1 || n === paginas || Math.abs(n - actual) <= 2) nums.push(n);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return <div className="paginador">
    <span>Total encontrados: <strong>{total.toLocaleString('es-PE')}</strong></span>
    <label><span>Registros por página</span><select value={pageSize} onChange={(e) => onSize(Number(e.target.value))}>{[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
    <span>Página <strong>{actual}</strong> de <strong>{paginas}</strong></span>
    <div className="paginas">
      <button className="secondary" disabled={actual <= 1} onClick={() => onPage(actual - 1)}>← Anterior</button>
      {nums.map((n, i) => n === '…' ? <span key={`e${i}`} className="puntos">…</span> : <button key={n} className={n === actual ? 'primary' : 'secondary'} onClick={() => onPage(n)}>{n}</button>)}
      <button className="secondary" disabled={actual >= paginas} onClick={() => onPage(actual + 1)}>Siguiente →</button>
    </div>
  </div>;
}

function claseCondicion(condicion: string) {
  const c = String(condicion || '').replace(/\*$/, '').trim();
  return c === 'CALIFICA' ? 'text-ok' : c === 'NO CALIFICA' ? 'text-pending' : 'text-bad';
}

type SortDir = 'asc' | 'desc';
type SortState = { key: string; dir: SortDir } | null;

// Clic en encabezado: asc -> desc -> sin orden. Nulos/vacíos siempre al final.
function nextSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

function applySort<T>(rows: T[], sort: SortState, get: (row: T, key: string) => string | number | null): T[] {
  if (!sort) return rows;
  const m = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((ra, rb) => {
    const va = get(ra, sort.key);
    const vb = get(rb, sort.key);
    const aNull = va === null || va === undefined || va === '';
    const bNull = vb === null || vb === undefined || vb === '';
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * m;
    return String(va).localeCompare(String(vb), 'es', { numeric: true }) * m;
  });
}

function SortTh({ label, k, sort, onSort, titulo }: { label: string; k: string; sort: SortState; onSort: (k: string) => void; titulo?: string }) {
  const active = sort?.key === k;
  return <span className={`sortable${active ? ' active' : ''}`} title={titulo || `${label}: clic para ordenar`} onClick={() => onSort(k)}>{label}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>;
}

type ResultadoEval = {
  numero: number; tipo_doc: string; numero_documento: string;
  numero_perfil: string; apellidos_nombres: string;
  puntaje: string; condicion: string;
};

// Puntaje a número en memoria (el JSON guarda el texto exacto del PDF;
// "-" de NO SE PRESENTÓ no tiene valor numérico).
function numPuntajeEval(puntaje: string): number | null {
  if (String(puntaje).trim() === '-') return null;
  const v = Number(String(puntaje).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

// Ponderación oficial: aptitud 20% + conocimientos 30% + evaluación curricular 30%.
const PESO_APTITUD = 0.20;
const PESO_CONOCIMIENTOS = 0.30;
const PESO_CURRICULAR = 0.30;

type EvalTag = 'aptitud' | 'conocimientos' | 'curricular';

const EVAL_LOADERS: Record<EvalTag, () => Promise<{ default: { resultados?: ResultadoEval[] } }>> = {
  aptitud: () => import('./data/resultados_aptitud_2026.json'),
  conocimientos: () => import('./data/resultados_conocimientos_2026.json'),
  curricular: () => import('./data/resultados_curricular_2026.json'),
};

type PadronData = {
  porDni: Map<string, Postulante2026>;
  perfiles: Map<string, Perfil2026>;
};

// Padrón ya cargado (postulantes + perfiles 2026) para hacer match por DNI/puesto.
function usePadron() {
  const [padron, setPadron] = useState<PadronData | null>(null);
  useEffect(() => {
    let vivo = true;
    Promise.all([import('./data/postulantes2026.json'), import('./data/perfiles2026.json')])
      .then(([qm, fm]) => {
        if (!vivo) return;
        const postulantes = (qm.default.postulantes || []) as Postulante2026[];
        const perfiles = (fm.default.perfiles || []) as Perfil2026[];
        setPadron({
          porDni: new Map(postulantes.map((p) => [p.numero_documento, p])),
          perfiles: new Map(perfiles.map((p) => [clavePerfil(p.cod_perfil), p])),
        });
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);
  return padron;
}

function useEval(tag: EvalTag) {
  const [data, setData] = useState<ResultadoEval[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let vivo = true;
    setError('');
    EVAL_LOADERS[tag]()
      .then((mod) => { if (vivo) setData((mod.default.resultados || []) as ResultadoEval[]); })
      .catch(() => { if (vivo) setError(`No se pudo cargar resultados de ${tag} 2026.`); });
    return () => { vivo = false; };
  }, [tag]);
  return { data, error };
}

function SeccionEval({ titulo, tag }: { titulo: string; tag: EvalTag }) {
  const { data, error } = useEval(tag);
  const padron = usePadron();
  const [dni, setDni] = useState('');
  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [perfilTxt, setPerfilTxt] = useState('');
  const [puesto, setPuesto] = useState('TODOS');
  const [perfil, setPerfil] = useState('TODOS');
  const [cond, setCond] = useState('TODOS');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortState>(null);

  const conds = useMemo(() => unique((data || []).map((r) => r.condicion)).sort(), [data]);
  const perfilesPresentes = useMemo(() => unique((data || []).map((r) => r.numero_perfil.trim()).filter(Boolean)).sort((a, b) => Number(a) - Number(b)), [data]);
  const puestosPresentes = useMemo(() => {
    if (!padron) return [];
    return unique((data || []).map((r) => padron.perfiles.get(r.numero_perfil.trim())?.nombre_puesto || '').filter(Boolean)).sort((a, b) => a.localeCompare(b));
  }, [data, padron]);

  const stats = useMemo(() => {
    if (!data) return null;
    const nums = data.map((r) => numPuntajeEval(r.puntaje)).filter((v): v is number => v !== null);
    const porCond: Record<string, number> = {};
    data.forEach((r) => { porCond[r.condicion] = (porCond[r.condicion] || 0) + 1; });
    return {
      total: data.length,
      porCond,
      max: nums.length ? Math.max(...nums) : null,
      prom: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
    };
  }, [data]);

  const nombreDe = (r: ResultadoEval) => r.apellidos_nombres || padron?.porDni.get(r.numero_documento)?.apellidos_nombres || '';
  const puestoDe = (r: ResultadoEval) => padron?.perfiles.get(r.numero_perfil.trim())?.nombre_puesto || '';

  const filtrados = useMemo(() => {
    const d = dni.trim(), n = nombre.trim().toLowerCase();
    const c = codigo.trim(), t = perfilTxt.trim().toLowerCase();
    return (data || [])
      .filter((r) => !d || r.numero_documento.includes(d))
      .filter((r) => {
        if (!n) return true;
        if (r.apellidos_nombres.toLowerCase().includes(n)) return true;
        const pad = padron?.porDni.get(r.numero_documento);
        return pad ? pad.apellidos_nombres.toLowerCase().includes(n) : false;
      })
      .filter((r) => {
        if (!c) return true;
        const np = r.numero_perfil.trim();
        const grupos = c.match(/\d+/g) || [];
        if (!np || !grupos.length) return false;
        return grupos.some((g) => np.includes(g));
      })
      .filter((r) => !t || puestoDe(r).toLowerCase().includes(t))
      .filter((r) => puesto === 'TODOS' || puestoDe(r) === puesto)
      .filter((r) => perfil === 'TODOS' || r.numero_perfil.trim() === perfil)
      .filter((r) => cond === 'TODOS' || r.condicion === cond)
      .sort((a, b) => a.numero - b.numero);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, padron, dni, nombre, codigo, perfilTxt, puesto, perfil, cond]);

  useEffect(() => { setPage(1); }, [dni, nombre, codigo, perfilTxt, puesto, perfil, cond, pageSize, tag]);

  const ordenados = useMemo(() => applySort(filtrados, sort, (r, key) => {
    switch (key) {
      case 'numero': return r.numero;
      case 'tipo': return r.tipo_doc;
      case 'doc': return r.numero_documento;
      case 'perfil': return r.numero_perfil.trim() ? Number(r.numero_perfil.trim()) : null;
      case 'nombres': return nombreDe(r);
      case 'puntaje': return numPuntajeEval(r.puntaje);
      case 'cond': return r.condicion;
      case 'puesto': return puestoDe(r);
      default: return null;
    }
  }), [filtrados, sort, padron]);

  const paginas = Math.max(1, Math.ceil(ordenados.length / pageSize));
  const safe = Math.min(Math.max(1, page), paginas);
  const pagina = ordenados.slice((safe - 1) * pageSize, safe * pageSize);

  const exportarCsv = () => exportCsv(csvFileName(`resultados-${tag}-2026`), ordenados, [
    { header: 'N°', value: (r) => r.numero },
    { header: 'TIPO DOC', value: (r) => r.tipo_doc },
    { header: 'N° DOCUMENTO', value: (r) => r.numero_documento },
    { header: 'N° PERFIL', value: (r) => r.numero_perfil },
    { header: 'APELLIDOS Y NOMBRES', value: (r) => nombreDe(r) },
    { header: 'PUNTAJE', value: (r) => r.puntaje },
    { header: 'CONDICIÓN', value: (r) => r.condicion },
    { header: 'PUESTO', value: (r) => puestoDe(r) },
  ]);

  return <section className="exam-card setup-card">
    <div className="quiz-topline"><div><p className="eyebrow">Concurso Público de Méritos N° 06-2026-CG</p><h2>{titulo}</h2></div></div>
    {!data && !error && <p className="warning">Cargando resultados...</p>}
    {error && <p className="warning" role="alert">{error}</p>}
    {data && stats && <>
      <div className="stats-grid plazas-stats">
        <span>Evaluados <strong>{stats.total.toLocaleString('es-PE')}</strong></span>
        {Object.entries(stats.porCond).map(([c, n]) => <span key={c}>{c.charAt(0) + c.slice(1).toLowerCase()} <strong>{(n as number).toLocaleString('es-PE')}</strong></span>)}
        <span>Puntaje máximo <strong>{stats.max ?? '—'}</strong></span>
        <span>Puntaje promedio <strong>{stats.prom !== null ? stats.prom.toFixed(2) : '—'}</strong></span>
      </div>
      <section className="toolbar setup plazas-filters" aria-label="Filtros de resultados">
        <label><span>DNI</span><input value={dni} onChange={(e) => setDni(e.target.value)} placeholder="N° de documento..." /></label>
        <label><span>Nombre</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Apellidos y nombres..." /></label>
        <label><span>Código</span><input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="N° de perfil, ej. 404..." /></label>
        <label><span>Perfil</span><input value={perfilTxt} onChange={(e) => setPerfilTxt(e.target.value)} placeholder="Texto del puesto, ej. auditor..." /></label>
        <label><span>Puesto</span><select value={puesto} onChange={(e) => setPuesto(e.target.value)}><option>TODOS</option>{puestosPresentes.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label><span>Perfil</span><select value={perfil} onChange={(e) => setPerfil(e.target.value)}><option>TODOS</option>{perfilesPresentes.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <label><span>Condición</span><select value={cond} onChange={(e) => setCond(e.target.value)}><option>TODOS</option>{conds.map((c) => <option key={c}>{c}</option>)}</select></label>
      </section>
      <div className="export-bar">
        <button className="secondary" onClick={exportarCsv} disabled={!ordenados.length}><Download size={16} /> Exportar CSV · {ordenados.length.toLocaleString('es-PE')} filas</button>
      </div>
      <div className="plazas-table eval-table">
        <div className="plazas-row plazas-head"><span title="Posición en el resultado">#</span><SortTh label="N°" k="numero" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="TIPO DOC" k="tipo" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="N° DOCUMENTO" k="doc" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="N° PERFIL" k="perfil" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="APELLIDOS Y NOMBRES" k="nombres" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="PUNTAJE" k="puntaje" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="CONDICIÓN" k="cond" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="PUESTO" k="puesto" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /></div>
        {pagina.map((r, i) => <div className="plazas-row" key={`${tag}-${r.numero}`}>
          <span>{(safe - 1) * pageSize + i + 1}</span>
          <span>{r.numero}</span>
          <span>{r.tipo_doc || '—'}</span>
          <span>{r.numero_documento}</span>
          <span>{r.numero_perfil}</span>
          <span>{nombreDe(r) || '—'}</span>
          <span>{r.puntaje}</span>
          <span className={claseCondicion(r.condicion)}><strong>{r.condicion || '—'}</strong></span>
          <span>{puestoDe(r) || '—'}</span>
        </div>)}
      </div>
      <Paginador total={filtrados.length} pageSize={pageSize} page={safe} onSize={setPageSize} onPage={setPage} />
      {filtrados.length === 0 && <p className="warning">Sin resultados para los filtros actuales.</p>}
    </>}
  </section>;
}

function SeccionConsolidado() {
  const [apt, setApt] = useState<ResultadoEval[] | null>(null);
  const [con, setCon] = useState<ResultadoEval[] | null>(null);
  const [cur, setCur] = useState<ResultadoEval[] | null>(null);
  const [error, setError] = useState('');
  const padron = usePadron();
  const [dni, setDni] = useState('');
  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [perfilTxt, setPerfilTxt] = useState('');
  const [puesto, setPuesto] = useState('TODOS');
  const [perfil, setPerfil] = useState('TODOS');
  const [lugar, setLugar] = useState('TODOS');
  const [curCond, setCurCond] = useState('TODOS');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortState>(null);
  const [pvPage, setPvPage] = useState(1);
  const [pvPageSize, setPvPageSize] = useState(25);
  const [pvSort, setPvSort] = useState<SortState>(null);
  const [perfilSel, setPerfilSel] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([EVAL_LOADERS.aptitud(), EVAL_LOADERS.conocimientos(), EVAL_LOADERS.curricular()])
      .then(([am, cm, um]) => {
        if (!vivo) return;
        setApt((am.default.resultados || []) as ResultadoEval[]);
        setCon((cm.default.resultados || []) as ResultadoEval[]);
        setCur((um.default.resultados || []) as ResultadoEval[]);
      })
      .catch(() => { if (vivo) setError('No se pudo cargar el consolidado 2026.'); });
    return () => { vivo = false; };
  }, []);

  const filas = useMemo(() => {
    if (!apt || !con || !cur) return [];
    const mA = new Map(apt.map((r) => [r.numero_documento, r]));
    const mC = new Map(con.map((r) => [r.numero_documento, r]));
    const mU = new Map(cur.map((r) => [r.numero_documento, r]));
    return unique([...mA.keys(), ...mC.keys(), ...mU.keys()]).sort().map((doc) => {
      const a = mA.get(doc) || null;
      const c = mC.get(doc) || null;
      const u = mU.get(doc) || null;
      const pad = padron?.porDni.get(doc) || null;
      const nombres = pad?.apellidos_nombres || a?.apellidos_nombres || c?.apellidos_nombres || u?.apellidos_nombres || '';
      const perf = (pad?.numero_perfil || '').trim() || (a?.numero_perfil || c?.numero_perfil || u?.numero_perfil || '').trim();
      const puestoN = (perf && padron?.perfiles.get(perf)?.nombre_puesto) || '';
      const lugarN = (perf && padron?.perfiles.get(perf)?.lugar_prestacion) || '';
      const paNum = a ? numPuntajeEval(a.puntaje) : null;
      const pcNum = c ? numPuntajeEval(c.puntaje) : null;
      const puNum = u ? numPuntajeEval(u.puntaje) : null;
      const prom = paNum !== null && pcNum !== null && puNum !== null
        ? paNum * PESO_APTITUD + pcNum * PESO_CONOCIMIENTOS + puNum * PESO_CURRICULAR
        : null;
      const perfilesEval = [a, c, u]
        .map((r) => (r?.numero_perfil || '').trim())
        .filter(Boolean);
      const distintoPerfil = new Set(perfilesEval).size > 1;
      return { dni: doc, nombres, perfil: perf, puesto: puestoN, lugar: lugarN, a, c, u, prom, distintoPerfil };
    });
  }, [apt, con, cur, padron]);

  const puestosPresentes = useMemo(() => unique(filas.map((f) => f.puesto).filter(Boolean)).sort((a, b) => a.localeCompare(b)), [filas]);
  const perfilesPresentes = useMemo(() => unique(filas.map((f) => f.perfil).filter(Boolean)).sort((a, b) => Number(a) - Number(b)), [filas]);
  const lugaresPresentes = useMemo(() => unique(filas.map((f) => f.lugar).filter(Boolean)).sort((a, b) => a.localeCompare(b)), [filas]);

  const curConds = useMemo(() => unique((cur || []).map((r) => r.condicion)).sort(), [cur]);

  const stats = useMemo(() => {
    const conAmbas = filas.filter((f) => f.a && f.c).length;
    const conTres = filas.filter((f) => f.prom !== null).length;
    const sinCurricular = filas.filter((f) => f.a && f.c && f.prom === null).length;
    const soloConoc = filas.filter((f) => !f.a && f.c && !f.u).length;
    const soloApt = filas.filter((f) => f.a && !f.c && !f.u).length;
    const soloCurricular = filas.filter((f) => !f.a && !f.c && f.u).length;
    const curCalifica = filas.filter((f) => f.u?.condicion === 'CALIFICA').length;
    const curNoCalifica = filas.filter((f) => f.u?.condicion === 'NO CALIFICA').length;
    const curDescalifica = filas.filter((f) => f.u?.condicion === 'DESCALIFICA').length;
    const proms = filas.map((f) => f.prom).filter((v): v is number => v !== null);
    return {
      total: filas.length, conAmbas, conTres, sinCurricular, soloConoc, soloApt, soloCurricular,
      curCalifica, curNoCalifica, curDescalifica,
      distintos: filas.filter((f) => f.distintoPerfil).length,
      promGral: proms.length ? proms.reduce((x, y) => x + y, 0) / proms.length : null,
    };
  }, [filas]);

  const filtradosBase = useMemo(() => {
    const d = dni.trim(), n = nombre.trim().toLowerCase();
    const c = codigo.trim(), t = perfilTxt.trim().toLowerCase();
    return filas
      .filter((f) => !d || f.dni.includes(d))
      .filter((f) => !n || f.nombres.toLowerCase().includes(n))
      .filter((f) => {
        if (!c) return true;
        const grupos = c.match(/\d+/g) || [];
        if (!f.perfil || !grupos.length) return false;
        return grupos.some((g) => f.perfil.includes(g));
      })
      .filter((f) => !t || f.puesto.toLowerCase().includes(t))
      .filter((f) => puesto === 'TODOS' || f.puesto === puesto)
      .filter((f) => perfil === 'TODOS' || f.perfil === perfil)
      .filter((f) => lugar === 'TODOS' || f.lugar === lugar)
      .filter((f) => curCond === 'TODOS' || f.u?.condicion === curCond);
  }, [filas, dni, nombre, codigo, perfilTxt, puesto, perfil, lugar, curCond]);

  // Presionar una fila de perfil muestra sus postulantes sin tocar el filtro Perfil.
  const filtrados = useMemo(() => (
    perfilSel ? filtradosBase.filter((f) => f.perfil === perfilSel) : filtradosBase
  ), [filtradosBase, perfilSel]);

  useEffect(() => { setPage(1); setPerfilSel(null); }, [dni, nombre, codigo, perfilTxt, puesto, perfil, lugar, curCond, pageSize]);
  useEffect(() => { setPvPage(1); }, [dni, nombre, codigo, perfilTxt, puesto, perfil, lugar, curCond, pvPageSize]);

  // Perfiles presentes en el resultado actual: al elegir lugar salen primero
  // los perfiles, y al presionar un perfil salen sus postulantes.
  // No depende de la fila presionada para no colapsar la lista.
  const perfilesVista = useMemo(() => {
    const agg = new Map<string, { count: number; proms: number[]; puesto: string; lugar: string }>();
    for (const f of filtradosBase) {
      if (!f.perfil) continue;
      const e = agg.get(f.perfil) || { count: 0, proms: [] as number[], puesto: f.puesto, lugar: f.lugar };
      e.count++;
      if (f.prom !== null) e.proms.push(f.prom);
      agg.set(f.perfil, e);
    }
    return [...agg.entries()].map(([numero, e]) => {
      const p = padron?.perfiles.get(numero);
      return {
        numero,
        puesto: e.puesto || p?.nombre_puesto || '',
        lugar: e.lugar || p?.lugar_prestacion || '',
        plazas: p?.numero_posiciones ?? null,
        postulantes: e.count,
        prom: e.proms.length ? e.proms.reduce((x, y) => x + y, 0) / e.proms.length : null,
      };
    });
  }, [filtradosBase, padron]);

  const perfilesVistaOrd = useMemo(() => applySort(perfilesVista, pvSort, (p, key) => {
    switch (key) {
      case 'cod': return Number(p.numero) || null;
      case 'puesto': return p.puesto;
      case 'lugar': return p.lugar;
      case 'plazas': return p.plazas;
      case 'post': return p.postulantes;
      case 'prom': return p.prom;
      default: return null;
    }
  }), [perfilesVista, pvSort]);
  const pvPaginas = Math.max(1, Math.ceil(perfilesVistaOrd.length / pvPageSize));
  const pvSafe = Math.min(Math.max(1, pvPage), pvPaginas);
  const pvPagina = perfilesVistaOrd.slice((pvSafe - 1) * pvPageSize, pvSafe * pvPageSize);

  const ordenados = useMemo(() => applySort(filtrados, sort, (f, key) => {
    switch (key) {
      case 'dni': return f.dni;
      case 'nombres': return f.nombres;
      case 'perfil': return f.perfil ? Number(f.perfil) : null;
      case 'puesto': return f.puesto;
      case 'lugar': return f.lugar;
      case 'apt': return f.a ? numPuntajeEval(f.a.puntaje) : null;
      case 'conoc': return f.c ? numPuntajeEval(f.c.puntaje) : null;
      case 'cur': return f.u ? numPuntajeEval(f.u.puntaje) : null;
      case 'prom': return f.prom;
      default: return null;
    }
  }), [filtrados, sort]);

  const paginas = Math.max(1, Math.ceil(ordenados.length / pageSize));
  const safe = Math.min(Math.max(1, page), paginas);
  const pagina = ordenados.slice((safe - 1) * pageSize, safe * pageSize);

  const exportarPerfilesCsv = () => exportCsv(csvFileName('consolidado-perfiles-2026'), perfilesVistaOrd, [
    { header: 'COD', value: (p) => p.numero },
    { header: 'PUESTO', value: (p) => p.puesto },
    { header: 'LUGAR', value: (p) => p.lugar },
    { header: 'PLAZAS', value: (p) => p.plazas },
    { header: 'POSTULANTES', value: (p) => p.postulantes },
    { header: 'PONDERADO', value: (p) => p.prom !== null ? p.prom.toFixed(2) : '' },
  ]);

  const exportarPostulantesCsv = () => exportCsv(csvFileName('consolidado-postulantes-2026'), ordenados, [
    { header: 'DNI', value: (f) => f.dni },
    { header: 'APELLIDOS Y NOMBRES', value: (f) => f.nombres },
    { header: 'PERFIL', value: (f) => f.perfil },
    { header: 'PUESTO', value: (f) => f.puesto },
    { header: 'LUGAR', value: (f) => f.lugar },
    { header: 'APTITUD', value: (f) => f.a?.puntaje ?? '' },
    { header: 'COND. APTITUD', value: (f) => f.a?.condicion ?? '' },
    { header: 'CONOCIMIENTOS', value: (f) => f.c?.puntaje ?? '' },
    { header: 'COND. CONOCIMIENTOS', value: (f) => f.c?.condicion ?? '' },
    { header: 'CURRICULAR', value: (f) => f.u?.puntaje ?? '' },
    { header: 'COND. CURRICULAR', value: (f) => f.u?.condicion ?? '' },
    { header: 'PONDERADO', value: (f) => f.prom !== null ? f.prom.toFixed(2) : '' },
  ]);

  return <section className="exam-card setup-card">
    <div className="quiz-topline"><div><p className="eyebrow">Concurso Público de Méritos N° 06-2026-CG</p><h2>Consolidado aptitud + conocimientos + evaluación curricular</h2></div></div>
    {(!apt || !con || !cur) && !error && <p className="warning">Cargando consolidado...</p>}
    {error && <p className="warning" role="alert">{error}</p>}
    {apt && con && cur && <>
      <div className="stats-grid plazas-stats">
        <span>Postulantes <strong>{stats.total.toLocaleString('es-PE')}</strong></span>
        <span>Con las 3 notas <strong>{stats.conTres.toLocaleString('es-PE')}</strong></span>
        <span>Aptitud + conocimientos sin nota curricular <strong>{stats.sinCurricular.toLocaleString('es-PE')}</strong></span>
        <span>Solo conocimientos <strong>{stats.soloConoc.toLocaleString('es-PE')}</strong></span>
        <span>Solo aptitud <strong>{stats.soloApt.toLocaleString('es-PE')}</strong></span>
        <span>Solo curricular <strong>{stats.soloCurricular.toLocaleString('es-PE')}</strong></span>
        <span>Curricular califica <strong>{stats.curCalifica.toLocaleString('es-PE')}</strong></span>
        <span>Curricular no califica <strong>{stats.curNoCalifica.toLocaleString('es-PE')}</strong></span>
        <span>Curricular descalifica <strong>{stats.curDescalifica.toLocaleString('es-PE')}</strong></span>
        <span>Promedio ponderado general <strong>{stats.promGral !== null ? stats.promGral.toFixed(2) : '—'}</strong></span>
        <span>Distinto perfil entre evaluaciones <strong>{stats.distintos}</strong></span>
      </div>
      <p className="source">Ponderado = aptitud × 20% + conocimientos × 30% + evaluación curricular × 30% (máx. 16 pts). Solo se calcula con las tres notas.</p>
      <section className="toolbar setup plazas-filters" aria-label="Filtros del consolidado">
        <label><span>DNI</span><input value={dni} onChange={(e) => setDni(e.target.value)} placeholder="N° de documento..." /></label>
        <label><span>Nombre</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Apellidos y nombres..." /></label>
        <label><span>Código</span><input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="N° de perfil, ej. 404..." /></label>
        <label><span>Perfil</span><input value={perfilTxt} onChange={(e) => setPerfilTxt(e.target.value)} placeholder="Texto del puesto, ej. auditor..." /></label>
        <label><span>Puesto</span><select value={puesto} onChange={(e) => setPuesto(e.target.value)}><option>TODOS</option>{puestosPresentes.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label><span>Perfil</span><select value={perfil} onChange={(e) => setPerfil(e.target.value)}><option>TODOS</option>{perfilesPresentes.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <label><span>Lugar de prestación</span><select value={lugar} onChange={(e) => setLugar(e.target.value)}><option>TODOS</option>{lugaresPresentes.map((l) => <option key={l}>{l}</option>)}</select></label>
        <label><span>Cond. curricular</span><select value={curCond} onChange={(e) => setCurCond(e.target.value)}><option>TODOS</option>{curConds.map((c) => <option key={c}>{c}</option>)}</select></label>
      </section>
      <div className="section-head">
        <h3>Perfiles ({perfilesVistaOrd.length}) — presiona un perfil para ver sus postulantes</h3>
        <button className="secondary" onClick={exportarPerfilesCsv} disabled={!perfilesVistaOrd.length}><Download size={16} /> Exportar CSV</button>
      </div>
      <div className="plazas-table cons-perf-table">
        <div className="plazas-row plazas-head"><span title="Posición en el resultado">#</span><SortTh label="COD" k="cod" sort={pvSort} onSort={(k) => setPvSort((s) => nextSort(s, k))} /><SortTh label="PUESTO" k="puesto" sort={pvSort} onSort={(k) => setPvSort((s) => nextSort(s, k))} /><SortTh label="LUGAR" k="lugar" sort={pvSort} onSort={(k) => setPvSort((s) => nextSort(s, k))} /><SortTh label="PLAZAS" k="plazas" sort={pvSort} onSort={(k) => setPvSort((s) => nextSort(s, k))} /><SortTh label="POSTULANTES" k="post" sort={pvSort} onSort={(k) => setPvSort((s) => nextSort(s, k))} /><SortTh label="PONDERADO" k="prom" sort={pvSort} onSort={(k) => setPvSort((s) => nextSort(s, k))} /></div>
        {pvPagina.map((p, i) => <div className={`plazas-row${perfilSel === p.numero ? ' selected' : ''}`} key={p.numero} onClick={() => setPerfilSel((v) => v === p.numero ? null : p.numero)}>
          <span>{(pvSafe - 1) * pvPageSize + i + 1}</span>
          <span><strong>{p.numero}</strong></span>
          <span>{p.puesto || '—'}</span>
          <span>{p.lugar || '—'}</span>
          <span>{p.plazas ?? '—'}</span>
          <span>{p.postulantes.toLocaleString('es-PE')}</span>
          <span>{p.prom !== null ? p.prom.toFixed(2) : '—'}</span>
        </div>)}
      </div>
      <Paginador total={perfilesVistaOrd.length} pageSize={pvPageSize} page={pvSafe} onSize={setPvPageSize} onPage={setPvPage} />
      <div className="section-head">
        <h3>Postulantes · Total encontrados: {filtrados.length.toLocaleString('es-PE')}{perfilSel ? ` · perfil ${perfilSel}` : ''}</h3>
        <button className="secondary" onClick={exportarPostulantesCsv} disabled={!ordenados.length}><Download size={16} /> Exportar CSV</button>
      </div>
      {perfilSel && <p><button className="ghost" onClick={() => setPerfilSel(null)}>← Ver todos los perfiles</button></p>}
      <div className="plazas-table cons-table">
        <div className="plazas-row plazas-head"><span title="Posición en el resultado">#</span><SortTh label="DNI" k="dni" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="APELLIDOS Y NOMBRES" k="nombres" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="PERFIL" k="perfil" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="PUESTO" k="puesto" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="LUGAR" k="lugar" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="APTITUD" k="apt" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="CONOCIM." k="conoc" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="CURRIC." k="cur" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /><SortTh label="PONDERADO" k="prom" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} /></div>
        {pagina.map((f, i) => <div className="plazas-row" key={f.dni}>
          <span>{(safe - 1) * pageSize + i + 1}</span>
          <span>{f.dni}</span>
          <span>{f.nombres || '—'}</span>
          <span>{f.perfil || '—'}</span>
          <span>{f.puesto || '—'}</span>
          <span>{f.lugar || '—'}</span>
          <span>{f.a ? <span className={claseCondicion(f.a.condicion)}>{f.a.puntaje} · {f.a.condicion}</span> : '—'}</span>
          <span>{f.c ? <span className={claseCondicion(f.c.condicion)}>{f.c.puntaje} · {f.c.condicion}</span> : '—'}</span>
          <span>{f.u ? <span className={claseCondicion(f.u.condicion)}>{f.u.puntaje} · {f.u.condicion}</span> : '—'}</span>
          <span><strong>{f.prom !== null ? f.prom.toFixed(2) : '—'}</strong></span>
        </div>)}
      </div>
      <Paginador total={filtrados.length} pageSize={pageSize} page={safe} onSize={setPageSize} onPage={setPage} />
      {filtrados.length === 0 && <p className="warning">Sin resultados para los filtros actuales.</p>}
    </>}
  </section>;
}
type StoredCatalog = { version: string; exams: Exam[]; customQuestions: Question[]; savedAt: string };

const baseQuestions = banco.preguntas as Question[];
const basePositions = puestosData.puestos as Position[];
const metadata = banco.metadata;
const QUESTION_AMOUNTS = [19, 20, 30, 40, 50, 100, 200];
const CATALOG_KEY = 'quiz-interactivo-catalogo-v2';
const HISTORY_KEY = 'quiz-interactivo-question-history-v2';
const RESULTS_KEY = 'quiz-interactivo-last-result-v2';
const SESSION_KEY = 'quiz-interactivo-sesion-v2';
const DEFAULT_CATEGORY = 'CONTRALORIA';
const NO_CARRERA = 'SIN CARRERA VERIFICADA';

// Versión de los datos base: cambia en cada `npm run extract` (generadoEn/preguntas/perfiles).
// Si el catálogo guardado es de una versión anterior, se reconstruye desde la base
// para que los PDFs nuevos y los cambios se reflejen sin borrar caché manualmente.
const BASE_VERSION = `v4|${metadata.generadoEn}|${metadata.preguntas}|${(puestosData.metadata as { generadoEn?: string })?.generadoEn || ''}|${(perfilesData.metadata as { generadoEn?: string })?.generadoEn || ''}|${basePositions.length}`;

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function cleanLabel(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function splitCarrerasInput(value: string) {
  return unique(String(value || '').split(/[,;]+/).map(cleanLabel));
}

const perfilesByCodigo = (perfilesData.byCodigo || {}) as Record<string, {
  codigo: string; puesto: string; posiciones: number | null; nivel_educativo: string;
  carreras_raw: string; carreras: string[]; region: string; lugares: string[];
  remuneracion: string | null; anio: number;
}>;

// Agrega perfiles por código (para PDFs importados desde la UI); exámenes agrupados unen lugares.
function perfilForCodes(codes: string[]) {
  const hits = codes.map((c) => perfilesByCodigo[c]).filter(Boolean);
  if (!hits.length) return null;
  const niveles = unique(hits.map((h) => h.nivel_educativo));
  const regiones = unique(hits.map((h) => h.region));
  return {
    nivel_educativo: niveles.length === 1 ? niveles[0] : niveles.join(' / '),
    carreras: unique(hits.flatMap((h) => h.carreras)).sort((a, b) => a.localeCompare(b)),
    region: regiones.length === 1 ? regiones[0] : regiones.join(' / '),
    regiones,
    lugares: unique(hits.flatMap((h) => h.lugares)),
  };
}

function yearFromText(value: string): number | null {
  const m = String(value || '').match(/((?:19|20)\d{2})/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1990 && n <= 2035 ? n : null;
}

function examYear(exam: Exam): number | null {
  return exam.anio ?? yearFromText(exam.codigo) ?? yearFromText(exam.archivo_pdf);
}

function yearLabel(year: number | null): string {
  return year ? String(year) : 'SIN AÑO';
}

function codesFromLabel(codigo: string): string[] {
  const out: string[] = [];
  const re = /(\d{3,4})\s*[-–—/]\s*((?:19|20)\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(codigo || '')))) {
    const code = `${m[1]}-${m[2]}`;
    if (!out.includes(code)) out.push(code);
  }
  return out;
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
    const grupo = position.grupo_id ?? position.fuente;
    const qs = baseQuestions.filter((question) => (question.grupo_id ?? question.fuente) === grupo);
    const perfil = position.perfil;
    const codes = (position as { codigos?: string[] }).codigos || [];
    return {
      id: position.id,
      codigo: codes.length ? `COD ${codes[0]}` : (position.codigo || 'SIN CODIGO VERIFICADO'),
      codigos: codes,
      puesto: normalizeValue(position.nombre),
      categoria: DEFAULT_CATEGORY,
      archivo_pdf: position.fuente,
      fecha_carga: '2026-09-23T00:00:00.000Z',
      preguntaIds: qs.map((question) => question.id),
      fuente: position.fuente,
      origen: 'base',
      anio: position.anio ?? null,
      nivel_educativo: perfil?.nivel_educativo ?? null,
      carreras: perfil?.carreras ?? [],
      carreras_raw: perfil?.carreras_raw ?? null,
      region: perfil?.region ?? null,
      regiones: perfil?.regiones ?? [],
      lugares: perfil?.lugares ?? [],
      posiciones: perfil?.posiciones ?? null,
      remuneracion: perfil?.remuneracion ?? null,
      perfilVerificado: Boolean(perfil),
      advertencias: !codes.length ? ['Código pendiente de revisión manual.'] : !perfil ? ['Sin match en anexos de posiciones: carrera y lugar pendientes de verificación.'] : [],
    };
  });
}

function migrateExam(exam: Exam): Exam {
  return {
    ...exam,
    codigos: exam.codigos || [],
    nivel_educativo: exam.nivel_educativo ?? null,
    carreras: Array.isArray((exam as { carreras?: unknown }).carreras) ? (exam.carreras as string[]) : [],
    carreras_raw: (exam as { carreras_raw?: string | null }).carreras_raw ?? null,
    region: exam.region ?? null,
    regiones: exam.regiones || [],
    lugares: exam.lugares || [],
    posiciones: exam.posiciones ?? null,
    remuneracion: exam.remuneracion ?? null,
    perfilVerificado: exam.perfilVerificado ?? ((exam.carreras as unknown as string[]) || []).length > 0,
  };
}

function loadCatalog(): { exams: Exam[]; questions: Question[] } {
  const base = buildBaseExams();
  try {
    const stored = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null') as StoredCatalog | null;
    if (stored?.exams?.length) {
      if (stored.version === BASE_VERSION) return { exams: stored.exams.map(migrateExam), questions: [...baseQuestions, ...(stored.customQuestions || [])] };
      // La base cambió (nuevo deploy con más PDFs): reconstruir desde la base
      // pero conservar los exámenes creados por el usuario y sus preguntas.
      const userExams = stored.exams.filter((exam) => exam.origen === 'usuario').map(migrateExam);
      const userQIds = new Set(userExams.flatMap((exam) => exam.preguntaIds));
      const customQuestions = (stored.customQuestions || []).filter((question) => userQIds.has(question.id));
      return { exams: [...base, ...userExams], questions: [...baseQuestions, ...customQuestions] };
    }
  } catch {
    // continúa con base
  }
  return { exams: base, questions: baseQuestions };
}

function saveCatalog(exams: Exam[], questions: Question[]) {
  const baseIds = new Set(baseQuestions.map((question) => question.id));
  const customQuestions = questions.filter((question) => !baseIds.has(question.id));
  localStorage.setItem(CATALOG_KEY, JSON.stringify({ version: BASE_VERSION, exams, customQuestions, savedAt: new Date().toISOString() } satisfies StoredCatalog));
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

// Sesión de práctica en curso: permite retomar el examen tras recargar la app.
// Guarda IDs (no objetos) para que la carga sea liviana; al restaurar se
// rehidrata desde el catálogo vigente y se descarta si el examen ya no existe.
type QuizSession = {
  screen: 'quiz' | 'results' | 'review';
  examId: string;
  questionIds: string[];
  current: number;
  answers: Answer[];
  startedAt: number | null;
  finishedAt: number | null;
  activeCarrera: string;
  savedAt: string;
};

function readSession(): QuizSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as QuizSession | null;
    if (!s || !['quiz', 'results', 'review'].includes(s.screen)) return null;
    if (!s.examId || !Array.isArray(s.questionIds) || !s.questionIds.length) return null;
    return s;
  } catch {
    return null;
  }
}

function writeSession(session: QuizSession | null) {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
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
  // Si había una práctica en curso al recargar, se retoma donde quedó.
  const restored = useMemo(() => {
    const s = readSession();
    if (!s) return null;
    const exam = initial.exams.find((e) => e.id === s.examId);
    if (!exam) return null;
    const byId = new Map(initial.questions.map((q) => [q.id, q]));
    const questions = s.questionIds.map((id) => byId.get(id)).filter(Boolean) as Question[];
    if (!questions.length) return null;
    const valid = new Set(questions.map((q) => q.id));
    return {
      screen: (s.screen === 'quiz' && s.finishedAt ? 'results' : s.screen) as Screen,
      exam,
      questions,
      current: Math.min(Math.max(0, s.current || 0), questions.length - 1),
      answers: (s.answers || []).filter((a) => a && valid.has(a.questionId)),
      startedAt: typeof s.startedAt === 'number' ? s.startedAt : Date.now(),
      finishedAt: typeof s.finishedAt === 'number' ? s.finishedAt : null,
      activeCarrera: s.activeCarrera || '',
    };
  }, [initial]);
  const [screen, setScreen] = useState<Screen>(restored?.screen ?? 'home');
  const [mode, setMode] = useState<AdminMode>('practice');
  const [allQuestions, setAllQuestions] = useState<Question[]>(initial.questions);
  const [exams, setExams] = useState<Exam[]>(initial.exams);
  const [query, setQuery] = useState('');
  const [selectedCarrera, setSelectedCarrera] = useState('TODOS');
  const [selectedYear, setSelectedYear] = useState('TODOS');
  const [selectedCode, setSelectedCode] = useState('TODOS');
  const [selectedExamId, setSelectedExamId] = useState('');
  const [questionAmount, setQuestionAmount] = useState(20);
  const [validation, setValidation] = useState('');
  const [drafts, setDrafts] = useState<DraftExam[]>([]);
  const [importing, setImporting] = useState(false);
  const [adminEditId, setAdminEditId] = useState('');
  const [quizQuestions, setQuizQuestions] = useState<Question[]>(restored?.questions ?? []);
  const [current, setCurrent] = useState(restored?.current ?? 0);
  const [answers, setAnswers] = useState<Answer[]>(restored?.answers ?? []);
  const [startedAt, setStartedAt] = useState<number | null>(restored?.startedAt ?? null);
  const [finishedAt, setFinishedAt] = useState<number | null>(restored?.finishedAt ?? null);
  const [elapsedMs, setElapsedMs] = useState(() => {
    if (!restored?.startedAt) return 0;
    if (restored.finishedAt) return Math.max(0, restored.finishedAt - restored.startedAt);
    return Math.max(0, Date.now() - restored.startedAt);
  });
  const [activeExam, setActiveExam] = useState<Exam | null>(restored?.exam ?? null);
  const [activeCarrera, setActiveCarrera] = useState(restored?.activeCarrera ?? '');
  const [plazas, setPlazas] = useState<PlazasData | null>(null);
  const [plazasLoading, setPlazasLoading] = useState(false);
  const [plazasError, setPlazasError] = useState('');
  const [plazaPerfil, setPlazaPerfil] = useState('TODOS');
  const [plazaUnidad, setPlazaUnidad] = useState('TODOS');
  const [plazaLugar, setPlazaLugar] = useState('TODOS');
  const [plazaCond, setPlazaCond] = useState('TODOS');
  const [plazaQuery, setPlazaQuery] = useState('');
  const [plazaSelected, setPlazaSelected] = useState<string | null>(null);
  const [plazaPage, setPlazaPage] = useState(1);
  const [plazaPageSize, setPlazaPageSize] = useState(25);
  const [perfilPage, setPerfilPage] = useState(1);
  const [perfilPageSize, setPerfilPageSize] = useState(50);
  const [perfilSort, setPerfilSort] = useState<SortState>(null);
  const [postSort, setPostSort] = useState<SortState>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => saveCatalog(exams, allQuestions), [exams, allQuestions]);

  // Persiste la práctica en curso para retomarla tras recargar.
  // Salir explícitamente al inicio (Volver) la descarta.
  useEffect(() => {
    if (screen === 'home' || !activeExam || !quizQuestions.length) {
      if (screen === 'home') writeSession(null);
      return;
    }
    writeSession({
      screen: screen as 'quiz' | 'results' | 'review',
      examId: activeExam.id,
      questionIds: quizQuestions.map((q) => q.id),
      current,
      answers,
      startedAt,
      finishedAt,
      activeCarrera,
      savedAt: new Date().toISOString(),
    });
  }, [screen, activeExam, quizQuestions, current, answers, startedAt, finishedAt, activeCarrera]);

  const questionById = useMemo(() => new Map(allQuestions.map((question) => [question.id, question])), [allQuestions]);
  const categories = useMemo(() => unique(exams.map((exam) => exam.categoria)).sort(), [exams]);
  const carreraOptions = useMemo(() => unique(exams.flatMap((exam) => exam.carreras)).filter((c) => c !== 'TODAS LAS CARRERAS').sort((a, b) => a.localeCompare(b)), [exams]);
  const matchCarrera = (exam: Exam, carrera: string) => carrera === 'TODOS' || exam.carreras.includes(carrera) || exam.carreras.includes('TODAS LAS CARRERAS');
  const yearsForSelection = useMemo(() => {
    const years = unique(exams.filter((exam) => matchCarrera(exam, selectedCarrera)).map((exam) => yearLabel(examYear(exam))));
    const numeric = years.filter((y) => y !== 'SIN AÑO').sort((a, b) => Number(b) - Number(a));
    if (years.includes('SIN AÑO')) numeric.push('SIN AÑO');
    return numeric;
  }, [exams, selectedCarrera]);
  const codesForSelection = useMemo(() => unique(exams
    .filter((exam) => matchCarrera(exam, selectedCarrera))
    .filter((exam) => selectedYear === 'TODOS' || yearLabel(examYear(exam)) === selectedYear)
    .flatMap((exam) => exam.codigos)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [exams, selectedCarrera, selectedYear]);
  const filteredExams = useMemo(() => exams
    .filter((exam) => matchCarrera(exam, selectedCarrera))
    .filter((exam) => selectedYear === 'TODOS' || yearLabel(examYear(exam)) === selectedYear)
    .filter((exam) => selectedCode === 'TODOS' || exam.codigos.includes(selectedCode))
    .filter((exam) => `${exam.codigos.map((c) => `COD ${c}`).join(' ')} ${exam.puesto} ${exam.archivo_pdf} ${exam.carreras.join(' ')} ${exam.region || ''} ${exam.lugares.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.puesto.localeCompare(b.puesto)), [exams, selectedCarrera, selectedYear, selectedCode, query]);
  const selectedExam = filteredExams.find((exam) => exam.id === selectedExamId) || null;
  const availableQuestions = selectedExam ? selectedExam.preguntaIds.map((id) => questionById.get(id)).filter(Boolean) as Question[] : [];
  const activeQuestion = quizQuestions[current];
  const selectedAnswer = activeQuestion ? answers.find((answer) => answer.questionId === activeQuestion.id)?.selected || '' : '';
  const progress = quizQuestions.length ? Math.round(((current + 1) / quizQuestions.length) * 100) : 0;

  useEffect(() => {
    if (selectedCarrera !== 'TODOS' && !carreraOptions.includes(selectedCarrera)) setSelectedCarrera('TODOS');
  }, [carreraOptions, selectedCarrera]);

  useEffect(() => {
    if (selectedYear !== 'TODOS' && !yearsForSelection.includes(selectedYear)) setSelectedYear('TODOS');
  }, [yearsForSelection, selectedYear]);

  useEffect(() => {
    if (selectedCode !== 'TODOS' && !codesForSelection.includes(selectedCode)) setSelectedCode('TODOS');
  }, [codesForSelection, selectedCode]);

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
      setActiveCarrera(selectedCarrera !== 'TODOS' ? selectedCarrera : selectedExam.carreras.join(', ') || NO_CARRERA);
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
    localStorage.setItem(RESULTS_KEY, JSON.stringify({ activeExam, activeCarrera, answers, elapsedMs: finalElapsed, finishedAt: new Date().toISOString() }));
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
        const perfil = perfilForCodes(detected.codes || []);
        const source = `USUARIO/${file.name}`;
        const examen = `${detected.codigo} - ${detected.puesto}`;
        const parsed = parseQuestionsFromText(rawText, source, examen, categoria, detected.echoLines) as Question[];
        const draft: DraftExam = {
          id: newDraftId(),
          archivo_pdf: file.name,
          codigo: detected.codigo,
          codigos: detected.codes || [],
          puesto: detected.puesto,
          categoria,
          carrera: (perfil?.carreras || []).join(', '),
          anio: detected.anio ?? yearFromText(file.name),
          nivel_educativo: perfil?.nivel_educativo ?? null,
          region: perfil?.region ?? null,
          lugar_prestacion: (perfil?.lugares || []).join('; '),
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
          codigos: [],
          puesto: normalizeValue(file.name.replace(/\.pdf$/i, '')),
          categoria: DEFAULT_CATEGORY,
          carrera: '',
          anio: yearFromText(file.name),
          nivel_educativo: null,
          region: null,
          lugar_prestacion: '',
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
    const carreras = splitCarrerasInput(draft.carrera);
    const puesto = normalizeValue(draft.puesto);
    if (!categoria || !carreras.length || !puesto) {
      alert('Categoría, carrera y puesto son obligatorios.');
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
      codigos: draft.codigos.length ? draft.codigos : codesFromLabel(draft.codigo),
      puesto,
      categoria,
      archivo_pdf: draft.archivo_pdf,
      fecha_carga: new Date().toISOString(),
      preguntaIds: questions.map((question) => question.id),
      fuente: `USUARIO/${draft.archivo_pdf}`,
      origen: 'usuario',
      anio: draft.anio ?? yearFromText(draft.codigo) ?? yearFromText(draft.archivo_pdf),
      nivel_educativo: cleanLabel(draft.nivel_educativo || '') || null,
      carreras,
      carreras_raw: carreras.join(' O ') || null,
      region: cleanLabel(draft.region || '') || null,
      regiones: cleanLabel(draft.region || '') ? [cleanLabel(draft.region || '')] : [],
      lugares: unique(String(draft.lugar_prestacion || '').split(';').map((l) => l.trim())).filter(Boolean),
      posiciones: null,
      remuneracion: null,
      perfilVerificado: Boolean(perfilForCodes(draft.codigos)),
      advertencias: draft.warnings,
    };
    setAllQuestions((prev) => [...prev, ...questions]);
    setExams((prev) => [...prev, exam]);
    setDrafts((prev) => prev.filter((item) => item.id !== draft.id));
    setSelectedCarrera(carreras[0] || 'TODOS');
    setSelectedYear(yearLabel(exam.anio));
    setSelectedCode('TODOS');
    setSelectedExamId(examId);
    setMode('practice');
  };

  const allAdminExams = useMemo(() => exams.filter((exam) => `${exam.categoria} ${exam.carreras.join(' ')} ${exam.codigos.map((c) => `COD ${c}`).join(' ')} ${exam.puesto} ${exam.archivo_pdf} ${exam.region || ''} ${yearLabel(examYear(exam))}`.toLowerCase().includes(query.toLowerCase())), [exams, query]);

  useEffect(() => {
    if (mode !== 'plazas' || plazas || plazasLoading) return;
    setPlazasLoading(true);
    setPlazasError('');
    Promise.all([import('./data/perfiles2026.json'), import('./data/postulantes2026.json')])
      .then(([perfilesMod, postulantesMod]) => {
        const perfiles = (perfilesMod.default.perfiles || []) as Perfil2026[];
        const postulantes = (postulantesMod.default.postulantes || []) as Postulante2026[];
        const unidades = [...new Set(perfiles.map((p) => p.unidad_organizacion))].sort((a, b) => a.localeCompare(b));
        const lugares = [...new Set(perfiles.map((p) => p.lugar_prestacion))].sort((a, b) => a.localeCompare(b));
        setPlazas({ perfiles, postulantes, unidades, lugares });
      })
      .catch(() => setPlazasError('No se pudo cargar la data de plazas 2026.'))
      .finally(() => setPlazasLoading(false));
  }, [mode, plazas, plazasLoading]);

  const condNormalizada = (c: string) => String(c || '').replace(/\*$/, '').trim() || '(vacía)';

  const postulantesPorPerfil = useMemo(() => {
    const map = new Map<string, { total: number; califica: number; noCalifica: number; descalifica: number }>();
    for (const p of plazas?.postulantes || []) {
      const key = p.numero_perfil.trim();
      if (!key) continue;
      if (!map.has(key)) map.set(key, { total: 0, califica: 0, noCalifica: 0, descalifica: 0 });
      const e = map.get(key)!;
      e.total += 1;
      const c = condNormalizada(p.condicion);
      if (c === 'CALIFICA') e.califica += 1;
      else if (c === 'NO CALIFICA') e.noCalifica += 1;
      else e.descalifica += 1;
    }
    return map;
  }, [plazas]);

  const plazasStats = useMemo(() => {
    if (!plazas) return null;
    const totalPlazas = plazas.perfiles.reduce((acc, p) => acc + p.numero_posiciones, 0);
    const califican = plazas.postulantes.filter((p) => condNormalizada(p.condicion) === 'CALIFICA').length;
    const sinPostulantes = plazas.perfiles.filter((p) => !postulantesPorPerfil.has(clavePerfil(p.cod_perfil))).length;
    return {
      perfiles: plazas.perfiles.length,
      plazas: totalPlazas,
      postulantes: plazas.postulantes.length,
      califican,
      ratio: totalPlazas ? (califican / totalPlazas).toFixed(1) : '—',
      sinPostulantes,
    };
  }, [plazas, postulantesPorPerfil]);

  const perfilesPorSelects = useMemo(() => (plazas?.perfiles || [])
    .filter((p) => plazaPerfil === 'TODOS' || p.cod_perfil === plazaPerfil)
    .filter((p) => plazaUnidad === 'TODOS' || p.unidad_organizacion === plazaUnidad)
    .filter((p) => plazaLugar === 'TODOS' || p.lugar_prestacion === plazaLugar)
    .sort((a, b) => Number(clavePerfil(a.cod_perfil)) - Number(clavePerfil(b.cod_perfil))), [plazas, plazaPerfil, plazaUnidad, plazaLugar]);

  const perfilesFiltrados = useMemo(() => {
    const q = plazaQuery.trim().toLowerCase();
    if (!q) return perfilesPorSelects;
    return perfilesPorSelects.filter((p) => `${p.cod_perfil} ${p.nombre_puesto} ${p.unidad_organizacion} ${p.lugar_prestacion}`.toLowerCase().includes(q));
  }, [perfilesPorSelects, plazaQuery]);

  const postulantesDetalle = useMemo(() => {
    if (!plazas) return [];
    const q = plazaQuery.trim().toLowerCase();
    const perfilTexto = new Map(plazas.perfiles.map((p) => [clavePerfil(p.cod_perfil), `${p.nombre_puesto} ${p.unidad_organizacion} ${p.lugar_prestacion}`.toLowerCase()]));
    let list = plazas.postulantes;
    if (plazaSelected) {
      const sel = clavePerfil(plazaSelected);
      list = list.filter((p) => p.numero_perfil.trim() === sel);
    } else if (perfilesPorSelects.length < plazas.perfiles.length) {
      const cods = new Set(perfilesPorSelects.map((p) => clavePerfil(p.cod_perfil)));
      list = list.filter((p) => cods.has(p.numero_perfil.trim()));
    }
    if (plazaCond !== 'TODOS') list = list.filter((p) => condNormalizada(p.condicion) === plazaCond);
    if (q) list = list.filter((p) => `${p.apellidos_nombres} ${p.numero_documento} ${p.numero_perfil}`.toLowerCase().includes(q) || (perfilTexto.get(p.numero_perfil.trim()) || '').includes(q));
    return [...list].sort((a, b) => a.numero - b.numero);
  }, [plazas, plazaSelected, perfilesPorSelects, plazaCond, plazaQuery]);

  // Vuelven a la primera página cuando cambian los filtros (el total nunca se recorta).
  useEffect(() => { setPlazaPage(1); }, [plazaPerfil, plazaUnidad, plazaLugar, plazaCond, plazaQuery, plazaSelected, plazaPageSize]);
  useEffect(() => { setPerfilPage(1); }, [plazaPerfil, plazaUnidad, plazaLugar, plazaQuery, perfilPageSize]);

  const perfilPaginas = Math.max(1, Math.ceil(perfilesFiltrados.length / perfilPageSize));
  const perfilPageSafe = Math.min(Math.max(1, perfilPage), perfilPaginas);
  const perfilesOrdenados = useMemo(() => applySort(perfilesFiltrados, perfilSort, (p, key) => {
    const c = postulantesPorPerfil.get(clavePerfil(p.cod_perfil));
    switch (key) {
      case 'cod': return Number(clavePerfil(p.cod_perfil)) || null;
      case 'puesto': return p.nombre_puesto;
      case 'unidad': return p.unidad_organizacion;
      case 'lugar': return p.lugar_prestacion;
      case 'plazas': return p.numero_posiciones;
      case 'post': return c ? c.total : 0;
      case 'ratio': return c && p.numero_posiciones ? c.califica / p.numero_posiciones : null;
      default: return null;
    }
  }), [perfilesFiltrados, perfilSort, postulantesPorPerfil]);
  const perfilesPagina = perfilesOrdenados.slice((perfilPageSafe - 1) * perfilPageSize, perfilPageSafe * perfilPageSize);
  const postPaginas = Math.max(1, Math.ceil(postulantesDetalle.length / plazaPageSize));
  const postPageSafe = Math.min(Math.max(1, plazaPage), postPaginas);
  const postulantesOrdenados = useMemo(() => applySort(postulantesDetalle, postSort, (p, key) => {
    switch (key) {
      case 'numero': return p.numero;
      case 'tipo': return p.tipo_doc;
      case 'doc': return p.numero_documento;
      case 'nombres': return p.apellidos_nombres;
      case 'perfil': return p.numero_perfil.trim() ? Number(p.numero_perfil.trim()) : null;
      case 'cond': return p.condicion;
      default: return null;
    }
  }), [postulantesDetalle, postSort]);
  const postulantesPagina = postulantesOrdenados.slice((postPageSafe - 1) * plazaPageSize, postPageSafe * plazaPageSize);
  const perfilSeleccionado = plazas?.perfiles.find((p) => p.cod_perfil === plazaSelected) || null;

  const exportarPerfilesPlazasCsv = () => exportCsv(csvFileName('plazas-perfiles-2026'), perfilesOrdenados, [
    { header: 'COD', value: (p) => p.cod_perfil },
    { header: 'CATEGORÍA REMUNERATIVA', value: (p) => p.categoria_remunerativa },
    { header: 'PUESTO', value: (p) => p.nombre_puesto },
    { header: 'UNIDAD DE ORGANIZACIÓN', value: (p) => p.unidad_organizacion },
    { header: 'LUGAR DE PRESTACIÓN', value: (p) => p.lugar_prestacion },
    { header: 'PLAZAS', value: (p) => p.numero_posiciones },
    { header: 'POSTULANTES', value: (p) => postulantesPorPerfil.get(clavePerfil(p.cod_perfil))?.total ?? 0 },
    { header: 'CALIFICAN', value: (p) => postulantesPorPerfil.get(clavePerfil(p.cod_perfil))?.califica ?? 0 },
    { header: 'NO CALIFICAN', value: (p) => postulantesPorPerfil.get(clavePerfil(p.cod_perfil))?.noCalifica ?? 0 },
    { header: 'DESCALIFICAN', value: (p) => postulantesPorPerfil.get(clavePerfil(p.cod_perfil))?.descalifica ?? 0 },
    { header: 'RATIO', value: (p) => {
      const c = postulantesPorPerfil.get(clavePerfil(p.cod_perfil));
      return c && p.numero_posiciones ? (c.califica / p.numero_posiciones).toFixed(1) : '';
    } },
    { header: 'REMUNERACIÓN', value: (p) => p.remuneracion ?? '' },
  ]);

  const exportarPostulantesPlazasCsv = () => exportCsv(csvFileName('plazas-postulantes-2026'), postulantesOrdenados, [
    { header: 'N°', value: (p) => p.numero },
    { header: 'TIPO DOC', value: (p) => p.tipo_doc },
    { header: 'N° DOCUMENTO', value: (p) => p.numero_documento },
    { header: 'APELLIDOS Y NOMBRES', value: (p) => p.apellidos_nombres },
    { header: 'N° PERFIL', value: (p) => p.numero_perfil },
    { header: 'CONDICIÓN', value: (p) => p.condicion },
  ]);

  const PERFIL_CONDS = ['TODOS', 'CALIFICA', 'NO CALIFICA', 'DESCALIFICA'];

  if (screen === 'quiz' && activeQuestion) {
    return <main className="shell quiz-shell">
      <button className="ghost" onClick={() => setScreen('home')}><ArrowLeft size={18} /> Volver</button>
      <section className="quiz-card" aria-live="polite">
        <div className="quiz-topline">
          <div>
            <p className="eyebrow">{activeExam?.categoria} · {activeCarrera}</p>
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
          <span>Carrera <strong>{activeCarrera}</strong></span>
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
        <h1>Exámenes por carrera, código, año y puesto</h1>
        <p>Practica con preguntas aleatorias.</p>
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
      <button className={mode === 'plazas' ? 'primary' : 'secondary'} onClick={() => setMode('plazas')}>Plazas 2026</button>
      <button className={mode === 'aptitud' ? 'primary' : 'secondary'} onClick={() => setMode('aptitud')}>Aptitud 2026</button>
      <button className={mode === 'conocimientos' ? 'primary' : 'secondary'} onClick={() => setMode('conocimientos')}>Conocimientos 2026</button>
      <button className={mode === 'curricular' ? 'primary' : 'secondary'} onClick={() => setMode('curricular')}>Evaluación curricular 2026</button>
      <button className={mode === 'consolidado' ? 'primary' : 'secondary'} onClick={() => setMode('consolidado')}>Consolidado 2026</button>
    </div>

    {mode === 'practice' && <>
      <section className="toolbar setup" aria-label="Configuración de práctica">
        <label><span>Carrera</span><select value={selectedCarrera} onChange={(event) => setSelectedCarrera(event.target.value)}><option>TODOS</option>{carreraOptions.map((carrera) => <option key={carrera} value={carrera}>{carrera}</option>)}</select></label>
        <label><span>Año</span><select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}><option>TODOS</option>{yearsForSelection.map((year) => <option key={year}>{year}</option>)}</select></label>
        <label><span>Código</span><select value={selectedCode} onChange={(event) => setSelectedCode(event.target.value)}><option>TODOS</option>{codesForSelection.map((code) => <option key={code} value={code}>COD {code}</option>)}</select></label>
        <label><span>Puesto</span><select value={selectedExamId} onChange={(event) => setSelectedExamId(event.target.value)}>{filteredExams.map((exam) => <option value={exam.id} key={exam.id}>{exam.puesto} ({exam.preguntaIds.length})</option>)}</select></label>
        <label className="search"><span>Buscar</span><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="COD, puesto, carrera, lugar..." /></label>
      </section>
      <section className="exam-card setup-card">
        <p className="eyebrow">Número de preguntas</p>
        <div className="amount-grid">{QUESTION_AMOUNTS.map((amount) => <button key={amount} className={questionAmount === amount ? 'primary' : 'secondary'} onClick={() => setQuestionAmount(amount)}>{amount}</button>)}</div>
        {selectedExam && <div className="position-summary">
          <h2>{selectedExam.puesto}</h2>
          <p><strong>Código:</strong> {selectedExam.codigos.length ? selectedExam.codigos.map((c) => `COD ${c}`).join(', ') : selectedExam.codigo}</p>
          <p><strong>Carrera:</strong> {selectedExam.carreras.length ? selectedExam.carreras.join(', ') : NO_CARRERA}</p>
          <p><strong>Nivel educativo:</strong> {selectedExam.nivel_educativo || '—'}</p>
          <p><strong>Región:</strong> {selectedExam.region || '—'}</p>
          {selectedExam.lugares.length > 0 && <div><strong>Lugar de prestación:</strong><ul className="lugares-list">{selectedExam.lugares.map((lugar) => <li key={lugar}>{lugar}</li>)}</ul></div>}
          {selectedExam.posiciones != null && <p><strong>Posiciones:</strong> {selectedExam.posiciones}</p>}
          {selectedExam.remuneracion && <p><strong>Remuneración:</strong> {selectedExam.remuneracion}</p>}
          <p><strong>Año:</strong> {yearLabel(examYear(selectedExam))}</p>
          <p><strong>PDF:</strong> {selectedExam.archivo_pdf}</p>
          <p><strong>Banco disponible:</strong> {availableQuestions.length} preguntas</p>
          {!selectedExam.perfilVerificado && <p className="warning">Sin match en anexos de posiciones: carrera y lugar pendientes de verificación.</p>}
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
            <label><span>Carrera (del anexo de posiciones)</span><input list="carrera-list" value={draft.carrera} onChange={(event) => updateDraft(draft.id, { carrera: event.target.value.toUpperCase() })} placeholder="DERECHO, CONTABILIDAD" /></label>
            <label><span>Nivel educativo</span><input value={draft.nivel_educativo || ''} onChange={(event) => updateDraft(draft.id, { nivel_educativo: event.target.value.toUpperCase() })} placeholder="TITULADO, COLEGIADO Y HABILITADO..." /></label>
            <label><span>Región</span><input value={draft.region || ''} onChange={(event) => updateDraft(draft.id, { region: event.target.value.toUpperCase() })} placeholder="LIMA" /></label>
            <label><span>Lugar de prestación (; para varios)</span><input value={draft.lugar_prestacion} onChange={(event) => updateDraft(draft.id, { lugar_prestacion: event.target.value })} placeholder="SEDE CENTRAL [01]" /></label>
          </div>
          <datalist id="category-list">{categories.map((category) => <option key={category} value={category} />)}</datalist>
          <datalist id="carrera-list">{carreraOptions.map((carrera) => <option key={carrera} value={carrera} />)}</datalist>
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
      <div className="quiz-topline"><div><p className="eyebrow">Administración</p><h2>Exámenes cargados</h2></div><label className="search admin-search"><span>Buscar</span><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Carrera, código, puesto..." /></label></div>
      <div className="admin-table">
        <div className="admin-row admin-head"><span>Categoría</span><span>Código</span><span>Puesto</span><span>Carrera</span><span>Preguntas</span><span>Acciones</span></div>
        {allAdminExams.map((exam) => <div className="admin-row" key={exam.id}>
          {adminEditId === exam.id ? <>
            <input value={exam.categoria} onChange={(event) => updateExam(exam.id, { categoria: normalizeValue(event.target.value) })} />
            <input value={exam.codigo} onChange={(event) => updateExam(exam.id, { codigo: event.target.value })} />
            <input value={exam.puesto} onChange={(event) => updateExam(exam.id, { puesto: normalizeValue(event.target.value) })} />
            <input value={exam.carreras.join(', ')} onChange={(event) => updateExam(exam.id, { carreras: splitCarrerasInput(event.target.value) })} />
            <span>{exam.preguntaIds.length}</span>
            <span><button className="primary" onClick={() => setAdminEditId('')}>Guardar</button></span>
          </> : <>
            <span>{exam.categoria}</span><span>{exam.codigo}</span><span>{exam.puesto}</span><span>{exam.carreras.join(', ') || NO_CARRERA}</span><span>{exam.preguntaIds.length}</span>
            <span className="row-actions"><button className="secondary" onClick={() => setAdminEditId(exam.id)}>Editar</button><button className="ghost" onClick={() => deleteExam(exam.id)}><Trash2 size={16} /> Eliminar</button></span>
          </>}
        </div>)}
      </div>
    </section>}

    {mode === 'plazas' && <section className="exam-card setup-card">
      <div className="quiz-topline"><div><p className="eyebrow">Concurso Público de Méritos N° 06-2026-CG</p><h2>Plazas y postulantes 2026</h2></div></div>
      {plazasLoading && <p className="warning">Cargando plazas 2026...</p>}
      {plazasError && <p className="warning" role="alert">{plazasError}</p>}
      {plazas && plazasStats && <>
        <div className="stats-grid plazas-stats">
          <span>Perfiles <strong>{plazasStats.perfiles}</strong></span>
          <span>Plazas <strong>{plazasStats.plazas.toLocaleString('es-PE')}</strong></span>
          <span>Postulantes <strong>{plazasStats.postulantes.toLocaleString('es-PE')}</strong></span>
          <span>Califican <strong>{plazasStats.califican.toLocaleString('es-PE')}</strong></span>
          <span>Postulantes por plaza <strong>{plazasStats.ratio}</strong></span>
          <span>Perfiles sin postulantes <strong>{plazasStats.sinPostulantes}</strong></span>
        </div>
        <section className="toolbar setup plazas-filters" aria-label="Filtros de plazas">
          <label><span>Perfil</span><select value={plazaPerfil} onChange={(event) => { setPlazaPerfil(event.target.value); setPlazaSelected(event.target.value === 'TODOS' ? null : event.target.value); }}><option>TODOS</option>{plazas.perfiles.map((p) => <option key={p.cod_perfil} value={p.cod_perfil}>{clavePerfil(p.cod_perfil)} — {p.nombre_puesto.slice(0, 60)}</option>)}</select></label>
          <label><span>Unidad de organización</span><select value={plazaUnidad} onChange={(event) => setPlazaUnidad(event.target.value)}><option>TODOS</option>{plazas.unidades.map((u) => <option key={u}>{u}</option>)}</select></label>
          <label><span>Lugar de prestación</span><select value={plazaLugar} onChange={(event) => setPlazaLugar(event.target.value)}><option>TODOS</option>{plazas.lugares.map((l) => <option key={l}>{l}</option>)}</select></label>
          <label><span>Condición</span><select value={plazaCond} onChange={(event) => setPlazaCond(event.target.value)}>{PERFIL_CONDS.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="search"><span>Buscar</span><Search size={18} /><input value={plazaQuery} onChange={(event) => { setPlazaQuery(event.target.value); setPlazaSelected(null); setPlazaPerfil('TODOS'); }} placeholder="Perfil, puesto, nombre, documento..." /></label>
        </section>
        <div className="section-head">
          <h3>Perfiles ({perfilesFiltrados.length})</h3>
          <button className="secondary" onClick={exportarPerfilesPlazasCsv} disabled={!perfilesOrdenados.length}><Download size={16} /> Exportar CSV</button>
        </div>
        <div className="plazas-table">
          <div className="plazas-row plazas-head"><span title="Posición en el resultado">#</span><SortTh label="COD" k="cod" sort={perfilSort} onSort={(k) => setPerfilSort((s) => nextSort(s, k))} /><SortTh label="Puesto" k="puesto" sort={perfilSort} onSort={(k) => setPerfilSort((s) => nextSort(s, k))} /><SortTh label="Unidad" k="unidad" sort={perfilSort} onSort={(k) => setPerfilSort((s) => nextSort(s, k))} /><SortTh label="Lugar" k="lugar" sort={perfilSort} onSort={(k) => setPerfilSort((s) => nextSort(s, k))} /><SortTh label="Plazas" k="plazas" sort={perfilSort} onSort={(k) => setPerfilSort((s) => nextSort(s, k))} /><SortTh label="Postulantes" k="post" sort={perfilSort} onSort={(k) => setPerfilSort((s) => nextSort(s, k))} /><SortTh label="Ratio" k="ratio" sort={perfilSort} onSort={(k) => setPerfilSort((s) => nextSort(s, k))} /></div>
          {perfilesPagina.map((p, i) => {
            const c = postulantesPorPerfil.get(clavePerfil(p.cod_perfil)) || { total: 0, califica: 0, noCalifica: 0, descalifica: 0 };
            return <div className={`plazas-row${plazaSelected === p.cod_perfil ? ' selected' : ''}`} key={p.cod_perfil} onClick={() => setPlazaSelected((v) => v === p.cod_perfil ? null : p.cod_perfil)}>
              <span>{(perfilPageSafe - 1) * perfilPageSize + i + 1}</span>
              <span><strong>COD {p.cod_perfil}</strong><br />{p.categoria_remunerativa}</span>
              <span>{p.nombre_puesto}</span>
              <span>{p.unidad_organizacion}</span>
              <span>{p.lugar_prestacion}</span>
              <span>{p.numero_posiciones}</span>
              <span>{c.califica.toLocaleString('es-PE')} / {c.total.toLocaleString('es-PE')}</span>
              <span>{p.numero_posiciones ? (c.califica / p.numero_posiciones).toFixed(1) : '—'}</span>
            </div>;
          })}
        </div>
        <Paginador total={perfilesFiltrados.length} pageSize={perfilPageSize} page={perfilPageSafe} onSize={setPerfilPageSize} onPage={setPerfilPage} />
        <div className="section-head">
          <h3>Postulantes · Total encontrados: {postulantesDetalle.length.toLocaleString('es-PE')}</h3>
          <button className="secondary" onClick={exportarPostulantesPlazasCsv} disabled={!postulantesOrdenados.length}><Download size={16} /> Exportar CSV</button>
        </div>
        {perfilSeleccionado && <div className="position-summary">
          <h2>PERFIL {perfilSeleccionado.cod_perfil}</h2>
          <p><strong>Puesto:</strong> {perfilSeleccionado.nombre_puesto}</p>
          <p><strong>Total de postulantes:</strong> {postulantesDetalle.length.toLocaleString('es-PE')}</p>
          <p><strong>Página {postPageSafe} de {postPaginas}</strong></p>
        </div>}
        {plazaSelected && <p><button className="ghost" onClick={() => { setPlazaSelected(null); setPlazaPerfil('TODOS'); }}>← Ver todos los perfiles</button></p>}
        <div className="plazas-table postulantes-table">
          <div className="plazas-row plazas-head"><span title="Posición en el resultado">#</span><SortTh label="N°" k="numero" sort={postSort} onSort={(k) => setPostSort((s) => nextSort(s, k))} /><SortTh label="TIPO DOC" k="tipo" sort={postSort} onSort={(k) => setPostSort((s) => nextSort(s, k))} /><SortTh label="N° DOCUMENTO" k="doc" sort={postSort} onSort={(k) => setPostSort((s) => nextSort(s, k))} /><SortTh label="APELLIDOS Y NOMBRES" k="nombres" sort={postSort} onSort={(k) => setPostSort((s) => nextSort(s, k))} /><SortTh label="N° PERFIL" k="perfil" sort={postSort} onSort={(k) => setPostSort((s) => nextSort(s, k))} /><SortTh label="CONDICIÓN" k="cond" sort={postSort} onSort={(k) => setPostSort((s) => nextSort(s, k))} /></div>
          {postulantesPagina.map((p, i) => <div className="plazas-row" key={p.numero}>
            <span>{(postPageSafe - 1) * plazaPageSize + i + 1}</span>
            <span>{p.numero}</span>
            <span>{p.tipo_doc}</span>
            <span>{p.numero_documento}</span>
            <span>{p.apellidos_nombres}</span>
            <span>{p.numero_perfil}</span>
            <span className={condNormalizada(p.condicion) === 'CALIFICA' ? 'text-ok' : condNormalizada(p.condicion) === 'NO CALIFICA' ? 'text-pending' : 'text-bad'}><strong>{p.condicion || '—'}</strong></span>
          </div>)}
        </div>
        <Paginador total={postulantesDetalle.length} pageSize={plazaPageSize} page={postPageSafe} onSize={setPlazaPageSize} onPage={setPlazaPage} />
        {postulantesDetalle.length === 0 && <p className="warning">Sin resultados para los filtros actuales.</p>}
      </>}
    </section>}

    {mode === 'aptitud' && <SeccionEval titulo="Resultados de aptitud 2026" tag="aptitud" />}
    {mode === 'conocimientos' && <SeccionEval titulo="Resultados de conocimientos 2026" tag="conocimientos" />}
    {mode === 'curricular' && <SeccionEval titulo="Resultados de evaluación curricular 2026" tag="curricular" />}
    {mode === 'consolidado' && <SeccionConsolidado />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
