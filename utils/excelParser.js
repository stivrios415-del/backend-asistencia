const ExcelJS = require('exceljs');

async function parseExcel(fileBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  const worksheet = workbook.worksheets[0];
  const estudiantes = [];
  
  for (let i = 2; i <= worksheet.rowCount; i++) {
    const row = worksheet.getRow(i);
    const cedula = row.getCell(1).value;
    const nombre = row.getCell(2).value;
    const apellido = row.getCell(3).value;
    const grado = row.getCell(4).value;
    const seccion = row.getCell(5).value;
    
    if (cedula && nombre) {
      estudiantes.push({ cedula, nombre, apellido, grado, seccion });
    }
  }
  
  return estudiantes;
}

module.exports = { parseExcel };