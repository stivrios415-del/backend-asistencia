const supabase = require('../config/supabase');
const ExcelJS = require('exceljs');

// ========== FUNCIÓN AUXILIAR PARA CONTAR FALTAS EN EL MES ==========
async function contarFaltasEnMes(cedula, año, mes) {
  const primerDia = new Date(año, mes - 1, 1).toISOString().split('T')[0];
  const hoy = new Date();
  let ultimoDia;
  if (año === hoy.getFullYear() && mes === hoy.getMonth() + 1) {
    ultimoDia = hoy.toISOString().split('T')[0];
  } else {
    ultimoDia = new Date(año, mes, 0).toISOString().split('T')[0];
  }
  const { data, error } = await supabase
    .from('asistencia')
    .select('fecha')
    .eq('cedula', cedula)
    .gte('fecha', primerDia)
    .lte('fecha', ultimoDia);
  if (error) return 0;
  const diasConAsistencia = data.length;
  const diasTotales = Math.ceil((new Date(ultimoDia) - new Date(primerDia)) / (1000 * 60 * 60 * 24)) + 1;
  const faltas = diasTotales - diasConAsistencia;
  return faltas > 0 ? faltas : 0;
}

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

// Obtener asistencia del día (con faltas en el mes)
const getAsistenciaHoy = async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const añoActual = new Date().getFullYear();
  const mesActual = new Date().getMonth() + 1;
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
  
  const asistenciaConFaltas = await Promise.all(data.map(async (item) => {
    const cedula = item.estudiantes?.cedula;
    let faltas = 0;
    if (cedula) {
      faltas = await contarFaltasEnMes(cedula, añoActual, mesActual);
    }
    return {
      id: item.id,
      fecha: item.fecha,
      hora: item.hora,
      estudiante: item.estudiantes,
      faltasEnMes: faltas
    };
  }));
  
  console.log(`✅ Encontrados ${asistenciaConFaltas.length} registros`);
  res.json(asistenciaConFaltas);
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

// Exportar a Excel (solo estudiantes con asistencia, rango de fechas)
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

// Exportar reporte completo (todos los estudiantes, Presente/Ausente) con tablas separadas por grado/sección y mostrando el nombre del profesor
const exportarReporteCompletoExcel = async (req, res) => {
  const { fecha, usuario, nombreProfesor, grado, seccion } = req.query;
  if (!fecha) {
    return res.status(400).json({ error: 'Debe proporcionar una fecha (YYYY-MM-DD)' });
  }
  console.log(`📊 Exportando reporte completo - Fecha: ${fecha}, Usuario: ${usuario || 'anon'}, Nombre: ${nombreProfesor || 'No especificado'}, Grado: ${grado || 'todos'}, Sección: ${seccion || 'todas'}`);

  try {
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

    const { data: asistencias, error: errAsistencias } = await supabase
      .from('asistencia')
      .select('cedula, hora')
      .eq('fecha', fecha);
    if (errAsistencias) throw errAsistencias;

    const asistenciaMap = new Map();
    asistencias.forEach(a => asistenciaMap.set(a.cedula, a.hora));

    const grupos = new Map();
    estudiantes.forEach(est => {
      const key = `${est.grado}|${est.seccion}`;
      if (!grupos.has(key)) {
        grupos.set(key, { grado: est.grado, seccion: est.seccion, estudiantes: [] });
      }
      grupos.get(key).estudiantes.push(est);
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Asistencia_${fecha}`);
    
    const headerStyle = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF8FF' } } };
    let currentRow = 1;

    const fechaObj = new Date(fecha);
    const fechaLegible = fechaObj.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const fechaRow = worksheet.addRow([`Fecha: ${fechaLegible}`]);
    worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
    currentRow++;

    if (nombreProfesor) {
      const profRow = worksheet.addRow([`Generado por: ${nombreProfesor}`]);
      worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
      currentRow++;
    }

    worksheet.addRow([]);
    currentRow++;

    const gruposOrdenados = Array.from(grupos.values()).sort((a, b) => {
      if (a.grado !== b.grado) return a.grado.localeCompare(b.grado);
      return a.seccion.localeCompare(b.seccion);
    });
    
    for (const grupo of gruposOrdenados) {
      const titleRow = worksheet.addRow([`Grado ${grupo.grado} - Sección ${grupo.seccion}`]);
      worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
      titleRow.font = { bold: true, size: 12 };
      titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
      currentRow++;
      
      const headerRow = worksheet.addRow(['Cédula', 'Nombre', 'Apellido', 'Grado', 'Sección', 'Carrera', 'Estado', 'Hora de Escaneo']);
      headerRow.eachCell(cell => { cell.style = headerStyle; });
      currentRow++;
      
      for (const est of grupo.estudiantes) {
        const hora = asistenciaMap.get(est.cedula);
        const presente = !!hora;
        worksheet.addRow([
          est.cedula,
          est.nombre,
          est.apellido,
          est.grado,
          est.seccion,
          est.carrera || '',
          presente ? 'PRESENTE' : 'AUSENTE',
          hora || ''
        ]);
        currentRow++;
      }
      worksheet.addRow([]);
      currentRow++;
    }
    
    worksheet.columns.forEach(col => { col.width = 15; });

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `reporte_completo${grado ? `_${grado}` : ''}${seccion ? `_sec${seccion}` : ''}_${fecha}_${Date.now()}.xlsx`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('reportes')
      .upload(fileName, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
    const archivo_url = urlData.publicUrl;

    try {
      await supabase.from('reportes_generados').insert([{
        fecha_inicio: fecha,
        fecha_fin: fecha,
        archivo_url,
        usuario: usuario || 'profesor',
        grado: grado || null,
        seccion: seccion || null,
      }]);
    } catch (metaErr) {
      console.warn('⚠️ No se pudo guardar metadata', metaErr.message);
    }

    res.json({ success: true, url: archivo_url });
  } catch (error) {
    console.error('❌ Error en reporte completo:', error);
    res.status(500).json({ error: error.message });
  }
};

// Listar reportes generados
const getReportesGenerados = async (req, res) => {
  const { data, error } = await supabase
    .from('reportes_generados')
    .select('*')
    .order('fecha_generacion', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// ========== ESTADÍSTICAS DE ASISTENCIA ==========
const getEstadisticas = async (req, res) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    let inicio, fin;
    if (fechaInicio && fechaFin) {
      inicio = fechaInicio;
      fin = fechaFin;
    } else {
      const hoy = new Date();
      inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
      fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }

    // 1. Obtener todos los estudiantes
    const { data: estudiantes, error: errEst } = await supabase
      .from('estudiantes')
      .select('cedula, nombre, apellido, grado, seccion');
    if (errEst) throw errEst;

    // 2. Obtener todas las asistencias en el rango
    const { data: asistencias, error: errAsis } = await supabase
      .from('asistencia')
      .select('cedula, fecha')
      .gte('fecha', inicio)
      .lte('fecha', fin);
    if (errAsis) throw errAsis;

    // 3. Contar asistencias por estudiante
    const asistenciaCount = {};
    asistencias.forEach(a => {
      asistenciaCount[a.cedula] = (asistenciaCount[a.cedula] || 0) + 1;
    });

    // 4. Calcular total de días del rango (calendario)
    const startDate = new Date(inicio);
    const endDate = new Date(fin);
    const totalDias = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    // 5. Calcular faltas y asistencias por estudiante
    const estadisticas = estudiantes.map(est => {
      const asistencias = asistenciaCount[est.cedula] || 0;
      const faltas = totalDias - asistencias;
      return {
        ...est,
        asistencias,
        faltas: faltas > 0 ? faltas : 0,
        totalDias
      };
    });

    // 6. Obtener top 10 de más faltas y mejor récord (más asistencias)
    const masFaltas = [...estadisticas]
      .sort((a, b) => b.faltas - a.faltas)
      .slice(0, 10);
    const mejorRecord = [...estadisticas]
      .sort((a, b) => b.asistencias - a.asistencias)
      .slice(0, 10);

    res.json({ masFaltas, mejorRecord, totalDias });
  } catch (error) {
    console.error('❌ Error en estadísticas:', error);
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
  getReportesGenerados,
  getEstadisticas
};
