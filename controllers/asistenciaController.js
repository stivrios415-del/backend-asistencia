const supabase = require('../config/supabase');
const ExcelJS = require('exceljs');

// Registrar asistencia (por cédula escaneada)
const registrarAsistencia = async (req, res) => {
  console.log('📥 POST /api/asistencia - Body:', req.body);
  
  const { cedula } = req.body;
  if (!cedula) {
    console.log('❌ Cédula no proporcionada');
    return res.status(400).json({ error: 'Cédula no proporcionada' });
  }
  
  const hoy = new Date().toISOString().split('T')[0];
  const ahora = new Date().toLocaleTimeString('en-GB', { hour12: false });
  
  console.log(`🔍 Buscando estudiante con cédula: ${cedula}`);
  
  // ✅ Incluimos carrera y foto_url
  const { data: estudiante, error: errEstudiante } = await supabase
    .from('estudiantes')
    .select('cedula, nombre, apellido, grado, seccion, carrera, foto_url')
    .eq('cedula', cedula)
    .single();
  
  if (errEstudiante || !estudiante) {
    console.log('❌ Estudiante no encontrado');
    return res.status(404).json({ error: 'Estudiante no encontrado' });
  }
  
  console.log('✅ Estudiante encontrado:', estudiante);
  
  const { data: yaRegistro, error: errYaRegistro } = await supabase
    .from('asistencia')
    .select('id')
    .eq('cedula', cedula)
    .eq('fecha', hoy)
    .maybeSingle();
  
  if (yaRegistro) {
    console.log('⚠️ Estudiante ya registró asistencia hoy');
    return res.status(400).json({ 
      error: 'Este estudiante ya registró asistencia hoy',
      estudiante 
    });
  }
  
  console.log(`📝 Insertando asistencia para ${cedula} en fecha ${hoy} hora ${ahora}`);
  const { error: errAsistencia } = await supabase
    .from('asistencia')
    .insert([{ cedula, fecha: hoy, hora: ahora }]);
  
  if (errAsistencia) {
    console.log('❌ Error al insertar asistencia:', errAsistencia.message);
    return res.status(500).json({ error: 'Error al registrar asistencia: ' + errAsistencia.message });
  }
  
  console.log('✅ Asistencia registrada exitosamente');
  res.json({ 
    message: 'Asistencia registrada exitosamente',
    estudiante: {
      cedula: estudiante.cedula,
      nombre: estudiante.nombre,
      apellido: estudiante.apellido,
      grado: estudiante.grado,
      seccion: estudiante.seccion,
      carrera: estudiante.carrera || 'No especificada',
      foto_url: estudiante.foto_url || null
    },
    hora: ahora
  });
};

// Obtener asistencia del día
const getAsistenciaHoy = async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  console.log(`📋 Obteniendo asistencia del día: ${hoy}`);
  
  const { data, error } = await supabase
    .from('asistencia')
    .select(`
      id,
      fecha,
      hora,
      estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)
    `)
    .eq('fecha', hoy);
  
  if (error) {
    console.log('❌ Error al obtener asistencia:', error.message);
    return res.status(400).json({ error: error.message });
  }
  
  const asistencia = data.map(a => ({
    id: a.id,
    fecha: a.fecha,
    hora: a.hora,
    estudiante: a.estudiantes
  }));
  
  console.log(`✅ Encontrados ${asistencia.length} registros`);
  res.json(asistencia);
};

// Obtener asistencia por fecha específica
const getAsistenciaByFecha = async (req, res) => {
  const { fecha } = req.params;
  console.log(`📅 Obteniendo asistencia para fecha: ${fecha}`);
  
  const { data, error } = await supabase
    .from('asistencia')
    .select(`
      id,
      fecha,
      hora,
      estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)
    `)
    .eq('fecha', fecha);
  
  if (error) {
    console.log('❌ Error:', error.message);
    return res.status(400).json({ error: error.message });
  }
  res.json(data);
};

// Obtener asistencia por grado y sección (reportes)
const getAsistenciaPorGrado = async (req, res) => {
  const { grado, seccion, fecha } = req.query;
  const fechaFiltro = fecha || new Date().toISOString().split('T')[0];
  console.log(`📊 Reporte - Grado: ${grado}, Sección: ${seccion}, Fecha: ${fechaFiltro}`);
  
  const { data, error } = await supabase
    .from('asistencia')
    .select(`
      id,
      fecha,
      hora,
      estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)
    `)
    .eq('fecha', fechaFiltro);
  
  if (error) {
    console.log('❌ Error:', error.message);
    return res.status(400).json({ error: error.message });
  }
  
  let filtrados = data;
  if (grado) {
    filtrados = filtrados.filter(a => a.estudiantes?.grado === grado);
  }
  if (seccion) {
    filtrados = filtrados.filter(a => a.estudiantes?.seccion === seccion);
  }
  
  console.log(`✅ Filtrados: ${filtrados.length} registros`);
  res.json(filtrados);
};

// Limpiar toda la asistencia del día
const limpiarAsistenciaHoy = async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  console.log(`🗑️ Limpiando asistencia del día: ${hoy}`);
  
  const { error } = await supabase
    .from('asistencia')
    .delete()
    .eq('fecha', hoy);
  
  if (error) {
    console.log('❌ Error al limpiar:', error.message);
    return res.status(400).json({ error: error.message });
  }
  console.log('✅ Asistencia limpiada');
  res.json({ message: 'Asistencia del día limpiada' });
};

// Reporte por rango de fechas (JSON)
const getReporteAsistencia = async (req, res) => {
  const { fechaInicio, fechaFin } = req.query;
  console.log(`📊 Reporte JSON - Desde: ${fechaInicio}, Hasta: ${fechaFin}`);
  
  let query = supabase
    .from('asistencia')
    .select(`
      id,
      fecha,
      hora,
      estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)
    `);
  
  if (fechaInicio && fechaFin) {
    query = query.gte('fecha', fechaInicio).lte('fecha', fechaFin);
  } else if (fechaInicio) {
    query = query.gte('fecha', fechaInicio);
  } else if (fechaFin) {
    query = query.lte('fecha', fechaFin);
  }
  
  const { data, error } = await query.order('fecha', { ascending: false });
  
  if (error) {
    console.log('❌ Error en reporte:', error.message);
    return res.status(400).json({ error: error.message });
  }
  
  res.json(data);
};

// Exportar a Excel (solo estudiantes con asistencia, rango de fechas) – sin cambios
const exportarReporteExcel = async (req, res) => {
  const { fechaInicio, fechaFin, usuario } = req.query;
  console.log(`📊 Exportando Excel - Desde: ${fechaInicio}, Hasta: ${fechaFin}, Usuario: ${usuario || 'anon'}`);
  
  if (!fechaInicio || !fechaFin) {
    return res.status(400).json({ error: 'Debe proporcionar fechaInicio y fechaFin' });
  }
  
  let query = supabase
    .from('asistencia')
    .select(`
      id,
      fecha,
      hora,
      estudiantes (cedula, nombre, apellido, grado, seccion)
    `);
  query = query.gte('fecha', fechaInicio).lte('fecha', fechaFin);
  
  const { data, error } = await query.order('fecha', { ascending: false });
  if (error) {
    console.error('❌ Error consultando datos:', error);
    return res.status(400).json({ error: error.message });
  }
  
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Reporte Asistencia');
  worksheet.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Hora', key: 'hora', width: 10 },
    { header: 'Cédula', key: 'cedula', width: 15 },
    { header: 'Nombre', key: 'nombre', width: 20 },
    { header: 'Apellido', key: 'apellido', width: 20 },
    { header: 'Grado', key: 'grado', width: 8 },
    { header: 'Sección', key: 'seccion', width: 8 },
  ];
  data.forEach(item => {
    worksheet.addRow({
      fecha: item.fecha,
      hora: item.hora,
      cedula: item.estudiantes?.cedula || '',
      nombre: item.estudiantes?.nombre || '',
      apellido: item.estudiantes?.apellido || '',
      grado: item.estudiantes?.grado || '',
      seccion: item.estudiantes?.seccion || '',
    });
  });
  
  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `reporte_${fechaInicio}_a_${fechaFin}_${Date.now()}.xlsx`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('reportes')
    .upload(fileName, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  if (uploadError) {
    console.error('❌ Error subiendo archivo:', uploadError);
    return res.status(500).json({ error: 'Error al guardar el archivo en el servidor' });
  }
  
  const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
  const archivo_url = urlData.publicUrl;
  
  await supabase.from('reportes_generados').insert([{
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    archivo_url,
    usuario: usuario || 'profesor',
  }]);
  
  res.json({ success: true, url: archivo_url });
};

// ============================================================
// NUEVA VERSIÓN: Reporte completo con filtros por grado y sección
// Exportar reporte completo (todos los estudiantes, Presente/Ausente) para una fecha con filtros opcionales
const exportarReporteCompletoExcel = async (req, res) => {
  const { fecha, usuario, grado, seccion } = req.query;
  if (!fecha) {
    return res.status(400).json({ error: 'Debe proporcionar una fecha (YYYY-MM-DD)' });
  }
  console.log(`📊 Exportando reporte completo - Fecha: ${fecha}, Usuario: ${usuario || 'anon'}, Grado: ${grado || 'todos'}, Sección: ${seccion || 'todas'}`);

  try {
    // 1. Obtener estudiantes con filtros y orden (por grado, sección, apellido)
    let query = supabase
      .from('estudiantes')
      .select('cedula, nombre, apellido, grado, seccion, carrera')
      .order('grado', { ascending: true })
      .order('seccion', { ascending: true })
      .order('apellido', { ascending: true });
    
    if (grado) query = query.eq('grado', grado);
    if (seccion) query = query.eq('seccion', seccion);
    
    const { data: estudiantes, error: errEstudiantes } = await query;
    if (errEstudiantes) throw errEstudiantes;

    // 2. Obtener asistencias de esa fecha
    const { data: asistencias, error: errAsistencias } = await supabase
      .from('asistencia')
      .select('cedula, hora')
      .eq('fecha', fecha);
    if (errAsistencias) throw errAsistencias;

    const asistenciaMap = new Map();
    asistencias.forEach(a => {
      asistenciaMap.set(a.cedula, a.hora);
    });

    // 3. Generar Excel con grupos
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Asistencia_${fecha}`);
    
    // Estilos
    const headerStyle = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF8FF' } } };
    const groupStyle = { font: { bold: true, size: 12 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } } };
    
    // Columnas
    worksheet.columns = [
      { header: 'Cédula', key: 'cedula', width: 15 },
      { header: 'Nombre', key: 'nombre', width: 20 },
      { header: 'Apellido', key: 'apellido', width: 20 },
      { header: 'Grado', key: 'grado', width: 8 },
      { header: 'Sección', key: 'seccion', width: 8 },
      { header: 'Carrera', key: 'carrera', width: 20 },
      { header: 'Estado', key: 'estado', width: 12 },
      { header: 'Hora de Escaneo', key: 'hora', width: 12 },
    ];
    
    // Aplicar estilo a la cabecera
    worksheet.getRow(1).eachCell(cell => {
      cell.style = headerStyle;
    });

    let currentGrado = null;
    let currentSeccion = null;
    let rowIndex = 2; // empezamos después de la cabecera

    estudiantes.forEach(est => {
      const hora = asistenciaMap.get(est.cedula);
      const presente = !!hora;
      
      // Si cambia el grupo (grado o sección), insertar fila de título
      if (currentGrado !== est.grado || currentSeccion !== est.seccion) {
        currentGrado = est.grado;
        currentSeccion = est.seccion;
        
        // Insertar fila vacía como separador (opcional)
        if (rowIndex > 2) {
          const separatorRow = worksheet.addRow(['']);
          separatorRow.getCell(1).value = '';
          rowIndex++;
        }
        
        // Fila de título del grupo
        const titleRow = worksheet.addRow([`Grado ${est.grado} - Sección ${est.seccion}`, '', '', '', '', '', '', '']);
        titleRow.getCell(1).style = groupStyle;
        // Combinar celdas para el título (opcional, más elegante)
        worksheet.mergeCells(`A${rowIndex}:H${rowIndex}`);
        rowIndex++;
      }
      
      // Fila del estudiante
      const dataRow = worksheet.addRow({
        cedula: est.cedula,
        nombre: est.nombre,
        apellido: est.apellido,
        grado: est.grado,
        seccion: est.seccion,
        carrera: est.carrera || '',
        estado: presente ? 'PRESENTE' : 'AUSENTE',
        hora: hora || '',
      });
      rowIndex++;
    });

    // 4. Guardar buffer
    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `reporte_completo${grado ? `_${grado}` : ''}${seccion ? `_sec${seccion}` : ''}_${fecha}_${Date.now()}.xlsx`;
    
    // 5. Subir a Storage y devolver URL
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('reportes')
      .upload(fileName, buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
    const archivo_url = urlData.publicUrl;

    // Guardar metadata
    await supabase.from('reportes_generados').insert([{
      fecha_inicio: fecha,
      fecha_fin: fecha,
      archivo_url,
      usuario: usuario || 'profesor',
      grado: grado || null,
      seccion: seccion || null,
    }]);

    res.json({ success: true, url: archivo_url });
  } catch (error) {
    console.error('❌ Error en reporte completo:', error);
    res.status(500).json({ error: error.message });
  }
};
module.exports = {
  registrarAsistencia,
  getAsistenciaHoy,
  getAsistenciaByFecha,
  getAsistenciaPorGrado,
  limpiarAsistenciaHoy,
  getReporteAsistencia,
  exportarReporteExcel,
  exportarReporteCompletoExcel,
  getReportesGenerados
};