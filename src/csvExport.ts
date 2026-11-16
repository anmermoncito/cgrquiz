// Exportación CSV reutilizable para los módulos de resultados.
// - Separador: coma.
// - UTF-8 con BOM para que Excel respete tildes y ñ.
// - Escapa comillas, comas y saltos de línea según RFC 4180.
export type CsvValue = string | number | boolean | null | undefined;

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => CsvValue;
};

function celda(value: CsvValue): string {
  const texto = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function buildCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lineas = [columns.map((c) => celda(c.header)).join(',')];
  for (const row of rows) lineas.push(columns.map((c) => celda(c.value(row))).join(','));
  return lineas.join('\r\n');
}

// Nombre de archivo seguro y ordenable: prefijo_AAAA-MM-DD_HHmmss.csv
export function csvFileName(prefijo: string, fecha = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const base = prefijo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const sello = `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}_${p(fecha.getHours())}${p(fecha.getMinutes())}${p(fecha.getSeconds())}`;
  return `${base || 'exportacion'}_${sello}.csv`;
}

export function downloadCsv(filename: string, contenido: string): void {
  const blob = new Blob(['\uFEFF', contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = filename;
  enlace.style.display = 'none';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Dar tiempo al navegador a iniciar la descarga antes de liberar la URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv<T>(filename: string, rows: readonly T[], columns: readonly CsvColumn<T>[]): void {
  downloadCsv(filename, buildCsv(rows, columns));
}
