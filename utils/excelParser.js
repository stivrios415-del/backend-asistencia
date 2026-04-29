const ExcelJS = require('exceljs');

/**
 * Parsea un archivo Excel (.xlsx) y extrae los estudiantes.
 * Espera las columnas:
 *   1: cédula (obligatorio)
 *   2: nombre (obligatorio)
 *   3: apellido (opcional)
 *   4: grado (opcional)
 *   5: sección (opcional)
 *   6: carrera (opcional)
 */
async function parseExcel(fileBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  const worksheet = workbook.worksheets[0];
  const estudiantes = [];

  // Asumimos que la primera fila es encabezado, empezamos desde la fila 2
  for (let i = 2; i <= worksheet.rowCount; i++) {
    const row = worksheet.getRow(i);
    
    // Leer celdas y limpiar valores
    const cedula = row.getCell(1).value?.toString().trim();
    const nombre = row.getCell(2).value?.toString().trim();
    const apellido = row.getCell(3).value?.toString().trim() || '';
    const grado = row.getCell(4).value?.toString().trim() || '';
    const seccion = row.getCell(5).value?.toString().trim() || '';
    const carrera = row.getCell(6).value?.toString().trim() || null;

    // Validación mínima: cédula y nombre son obligatorios
    if (cedula && nombre) {
      estudiantes.push({
        cedula,
        nombre,
        apellido,
        grado,
        seccion,
        carrera,
      });
    }
  }
  
  return estudiantes;
}

// ✅ Exportación correcta (objeto con la función)
module.exports = { parseExcel };
