import * as XLSX from "xlsx";

/**
 * Exporta un arreglo de objetos a un archivo .xlsx y dispara la descarga
 * directo en el navegador. Cada llave del objeto se vuelve una columna.
 */
export function exportarExcel(nombreArchivo: string, datos: Record<string, any>[]) {
  if (!datos || datos.length === 0) {
    alert("No hay datos para exportar");
    return;
  }
  const hoja = XLSX.utils.json_to_sheet(datos);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Datos");
  XLSX.writeFile(libro, `${nombreArchivo}.xlsx`);
}

// Excel: nombres de hoja máx 31 caracteres, sin : \ / ? * [ ]
function sanitizarNombreHoja(nombre: string) {
  const limpio = nombre.replace(/[:\\/?*[\]]/g, "").trim();
  return (limpio || "Centro").slice(0, 31);
}

/**
 * Igual que exportarExcel, pero genera UN archivo con UNA HOJA POR CENTRO
 * (una pestaña de Excel por cada centro), en vez de todo en una sola tabla.
 * `datosPorCentro` es un objeto { "Bosques": [...], "Punto 45": [...] }.
 */
export function exportarExcelPorCentro(
  nombreArchivo: string,
  datosPorCentro: Record<string, Record<string, any>[]>
) {
  const libro = XLSX.utils.book_new();
  const nombresUsados = new Set<string>();
  let huboDatos = false;

  Object.keys(datosPorCentro)
    .sort()
    .forEach((centro) => {
      const datos = datosPorCentro[centro];
      if (!datos || datos.length === 0) return;
      huboDatos = true;

      let nombreHoja = sanitizarNombreHoja(centro);
      let i = 2;
      while (nombresUsados.has(nombreHoja)) {
        nombreHoja = sanitizarNombreHoja(`${centro} ${i}`);
        i++;
      }
      nombresUsados.add(nombreHoja);

      const hoja = XLSX.utils.json_to_sheet(datos);
      XLSX.utils.book_append_sheet(libro, hoja, nombreHoja);
    });

  if (!huboDatos) {
    alert("No hay datos para exportar");
    return;
  }
  XLSX.writeFile(libro, `${nombreArchivo}.xlsx`);
}
