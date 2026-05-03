const supabase = require('../config/supabase');
const ExcelJS = require('exceljs');

// ========== NORMALIZAR TEXTO ==========
function normalizarTexto(str) {
  if (!str) return '';
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// ========== CONTAR FALTAS EN EL MES ==========
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
    .from('asistencia').select('fecha').eq('cedula', cedula)
    .gte('fecha', primerDia).lte('fecha', ultimoDia);
  if (error) return 0;
  const diasTotales = Math.ceil((new Date(ultimoDia) - new Date(primerDia)) / (1000 * 60 * 60 * 24)) + 1;
  const faltas = diasTotales - data.length;
  return faltas > 0 ? faltas : 0;
}

// ========== HELPER: obtener filtros grado/carrera del profesor ==========
// Retorna: null = admin (sin filtro), [] = profesor sin asignaciones, [{grado,carrera}] = filtros
async function obtenerFiltrosProfesor(profesorEmail) {
  if (!profesorEmail || profesorEmail === 'all' || profesorEmail === '') return null;

  console.log('🔍 Buscando profesor con email:', profesorEmail);

  const { data: profesor, error: errProf } = await supabase
    .from('profesores').select('id, nombre').eq('email', profesorEmail.trim().toLowerCase()).single();

  // Intentar también sin normalizar si falla
  let profesorFinal = profesor;
  if (errProf || !profesor) {
    console.log('⚠️ No encontrado con lowercase, intentando sin transformar...');
    const { data: p2 } = await supabase
      .from('profesores').select('id, nombre').eq('email', profesorEmail.trim()).single();
    profesorFinal = p2;
  }

  if (!profesorFinal) {
    console.error('❌ Profesor no encontrado para email:', profesorEmail);
    // Devolver [] en lugar de throw para evitar 500 — el frontend verá datos vacíos
    return [];
  }

  console.log('✅ Profesor encontrado:', profesorFinal.nombre, '| ID:', profesorFinal.id);

  const { data: asignaciones, error: errAsig } = await supabase
    .from('profesor_asignaciones').select('grado, carrera').eq('profesor_id', profesorFinal.id);

  if (errAsig) {
    console.error('❌ Error obteniendo asignaciones:', errAsig.message);
    return [];
  }

  console.log('📋 Asignaciones encontradas:', JSON.stringify(asignaciones));
  return asignaciones || [];
}

// ========== HELPER: obtener IDs de materias del profesor ==========
async function obtenerIdsMateriaProfesor(profesorEmail) {
  if (!profesorEmail || profesorEmail === 'all' || profesorEmail === '') return null;

  const { data: profesor } = await supabase
    .from('profesores').select('id').eq('email', profesorEmail.trim()).single();
  if (!profesor) {
    // Intentar con lowercase
    const { data: p2 } = await supabase
      .from('profesores').select('id').eq('email', profesorEmail.trim().toLowerCase()).single();
    if (!p2) return [];
    const { data: materias } = await supabase.from('materias').select('id').eq('profesor_id', p2.id);
    return materias ? materias.map(m => m.id) : [];
  }

  const { data: materias } = await supabase.from('materias').select('id').eq('profesor_id', profesor.id);
  console.log('📚 Materias del profesor:', materias?.map(m => m.id));
  return materias ? materias.map(m => m.id) : [];
}

// ========== HELPER: obtener estudiantes filtrados por asignaciones ==========
async function obtenerEstudiantesFiltrados(filtros) {
  const { data, error } = await supabase
    .from('estudiantes')
    .select('cedula, nombre, apellido, grado, seccion, carrera')
    .order('apellido', { ascending: true });
  if (error) throw error;

  // null = admin, trae todos
  if (filtros === null) return data;

  // [] = profesor sin asignaciones
  if (filtros.length === 0) return [];

  // Filtrar en memoria usando normalización para evitar problemas de mayúsculas/acentos
  return data.filter(est => {
    const gradoEst = normalizarTexto(String(est.grado));
    const carreraEst = normalizarTexto(est.carrera);
    return filtros.some(f =>
      normalizarTexto(String(f.grado)) === gradoEst &&
      normalizarTexto(f.carrera) === carreraEst
    );
  });
}

// ========== REGISTRAR ASISTENCIA ==========
const registrarAsistencia = async (req, res) => {
  const { cedula, materiaId } = req.body;
  if (!cedula) return res.status(400).json({ error: 'Cédula no proporcionada' });
  if (!materiaId) return res.status(400).json({ error: 'Debe especificar la materia/clase' });

  const { data: materia, error: errMateria } = await supabase
    .from('materias').select('grado, carrera').eq('id', materiaId).single();
  if (errMateria || !materia) return res.status(404).json({ error: 'La clase seleccionada no existe' });

  const { data: estudiante, error: errEstudiante } = await supabase
    .from('estudiantes').select('cedula, nombre, apellido, grado, seccion, carrera, foto_url')
    .eq('cedula', cedula).single();
  if (errEstudiante || !estudiante) return res.status(404).json({ error: 'Estudiante no encontrado' });

  if (normalizarTexto(String(estudiante.grado)) !== normalizarTexto(String(materia.grado)) ||
      normalizarTexto(estudiante.carrera) !== normalizarTexto(materia.carrera)) {
    return res.status(400).json({
      error: `Este estudiante no pertenece a esta clase. Solo se permite para grado ${materia.grado} - ${materia.carrera}.`
    });
  }

  const hoy = new Date().toISOString().split('T')[0];
  const ahora = new Date().toLocaleTimeString('en-GB', { hour12: false });

  const { data: yaRegistro } = await supabase.from('asistencia').select('id')
    .eq('cedula', cedula).eq('fecha', hoy).maybeSingle();
  if (yaRegistro) return res.status(400).json({ error: 'Este estudiante ya registró asistencia hoy', estudiante });

  const { error: errAsistencia } = await supabase.from('asistencia')
    .insert([{ cedula, fecha: hoy, hora: ahora, materia_id: materiaId }]);
  if (errAsistencia) return res.status(500).json({ error: 'Error al registrar asistencia: ' + errAsistencia.message });

  res.json({
    message: 'Asistencia registrada exitosamente',
    estudiante: {
      cedula: estudiante.cedula, nombre: estudiante.nombre, apellido: estudiante.apellido,
      grado: estudiante.grado, seccion: estudiante.seccion,
      carrera: estudiante.carrera || 'No especificada', foto_url: estudiante.foto_url || null
    },
    hora: ahora
  });
};

// ========== ASISTENCIA DEL DÍA ==========
const getAsistenciaHoy = async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const añoActual = new Date().getFullYear();
  const mesActual = new Date().getMonth() + 1;
  const { profesorEmail } = req.query;
  if (!profesorEmail) return res.status(400).json({ error: 'Se necesita el email del profesor' });

  const { data: profesor, error: errProf } = await supabase
    .from('profesores').select('id').eq('email', profesorEmail).single();
  if (errProf || !profesor) return res.status(404).json({ error: 'Profesor no encontrado' });

  const { data: materias } = await supabase.from('materias').select('id').eq('profesor_id', profesor.id);
  if (!materias || materias.length === 0) return res.json([]);

  const { data, error } = await supabase.from('asistencia').select(`
    id, fecha, hora, materia_id,
    estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url),
    materias (nombre)
  `).eq('fecha', hoy).in('materia_id', materias.map(m => m.id));
  if (error) return res.status(400).json({ error: error.message });

  const result = await Promise.all(data.map(async item => ({
    id: item.id, fecha: item.fecha, hora: item.hora,
    estudiante: item.estudiantes,
    materia_nombre: item.materias?.nombre || 'Sin materia',
    faltasEnMes: item.estudiantes?.cedula
      ? await contarFaltasEnMes(item.estudiantes.cedula, añoActual, mesActual) : 0
  })));

  res.json(result);
};

// ========== ASISTENCIA POR FECHA ==========
const getAsistenciaByFecha = async (req, res) => {
  const { fecha } = req.params;
  const { data, error } = await supabase.from('asistencia').select(`
    id, fecha, hora,
    estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)
  `).eq('fecha', fecha);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// ========== ASISTENCIA POR GRADO/SECCIÓN ==========
const getAsistenciaPorGrado = async (req, res) => {
  const { grado, seccion, fecha } = req.query;
  const fechaFiltro = fecha || new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.from('asistencia').select(`
    id, fecha, hora,
    estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)
  `).eq('fecha', fechaFiltro);
  if (error) return res.status(400).json({ error: error.message });
  let filtrados = data;
  if (grado) filtrados = filtrados.filter(a => a.estudiantes?.grado === grado);
  if (seccion) filtrados = filtrados.filter(a => a.estudiantes?.seccion === seccion);
  res.json(filtrados);
};

// ========== LIMPIAR ASISTENCIA DEL DÍA ==========
const limpiarAsistenciaHoy = async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const { error } = await supabase.from('asistencia').delete().eq('fecha', hoy);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Asistencia del día limpiada' });
};

// ========== REPORTE JSON POR RANGO ==========
const getReporteAsistencia = async (req, res) => {
  const { fechaInicio, fechaFin, profesorEmail } = req.query;

  let query = supabase.from('asistencia').select(`
    id, fecha, hora, materia_id,
    estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url),
    materias (nombre, grado, seccion, carrera, profesor_id)
  `);

  if (fechaInicio && fechaFin) query = query.gte('fecha', fechaInicio).lte('fecha', fechaFin);
  else if (fechaInicio) query = query.gte('fecha', fechaInicio);
  else if (fechaFin) query = query.lte('fecha', fechaFin);

  if (profesorEmail && profesorEmail !== 'all' && profesorEmail !== '') {
    const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail);
    if (!idsMaterias || idsMaterias.length === 0) return res.json([]);
    query = query.in('materia_id', idsMaterias);
  }

  const { data, error } = await query.order('fecha', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data.map(item => ({ ...item, materia_nombre: item.materias?.nombre || 'Sin materia' })));
};

// ========== EXPORTAR EXCEL SIMPLE ==========
const exportarReporteExcel = async (req, res) => {
  const { fechaInicio, fechaFin, usuario } = req.query;
  if (!fechaInicio || !fechaFin) return res.status(400).json({ error: 'Debe proporcionar fechaInicio y fechaFin' });

  const { data, error } = await supabase.from('asistencia').select(`
    id, fecha, hora, estudiantes (cedula, nombre, apellido, grado, seccion)
  `).gte('fecha', fechaInicio).lte('fecha', fechaFin).order('fecha', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Reporte Asistencia');
  ws.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Hora', key: 'hora', width: 10 },
    { header: 'Cédula', key: 'cedula', width: 15 }, { header: 'Nombre', key: 'nombre', width: 20 },
    { header: 'Apellido', key: 'apellido', width: 20 }, { header: 'Grado', key: 'grado', width: 8 },
    { header: 'Sección', key: 'seccion', width: 8 },
  ];
  data.forEach(item => ws.addRow({
    fecha: item.fecha, hora: item.hora,
    cedula: item.estudiantes?.cedula || '', nombre: item.estudiantes?.nombre || '',
    apellido: item.estudiantes?.apellido || '', grado: item.estudiantes?.grado || '',
    seccion: item.estudiantes?.seccion || '',
  }));

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `reporte_${fechaInicio}_a_${fechaFin}_${Date.now()}.xlsx`;
  const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  if (uploadError) return res.status(500).json({ error: 'Error al guardar archivo' });

  const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
  await supabase.from('reportes_generados').insert([{
    fecha_inicio: fechaInicio, fecha_fin: fechaFin,
    archivo_url: urlData.publicUrl, usuario: usuario || 'profesor',
  }]);
  res.json({ success: true, url: urlData.publicUrl });
};

// ========== EXPORTAR REPORTE COMPLETO POR CLASE ==========
const exportarReporteCompletoExcel = async (req, res) => {
  const { fecha, usuario, nombreProfesor, grado, seccion, profesorEmail } = req.query;
  if (!fecha) return res.status(400).json({ error: 'Debe proporcionar una fecha (YYYY-MM-DD)' });

  const subirExcelVacio = async (mensaje) => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet(`Asistencia_${fecha}`).addRow([mensaje]);
    const buf = await wb.xlsx.writeBuffer();
    const fn = `reporte_vacio_${fecha}_${Date.now()}.xlsx`;
    await supabase.storage.from('reportes').upload(fn, buf, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const { data: u } = supabase.storage.from('reportes').getPublicUrl(fn);
    return u.publicUrl;
  };

  try {
    let queryAsistencias = supabase.from('asistencia').select(`
      cedula, hora, materia_id,
      estudiantes (cedula, nombre, apellido, grado, seccion, carrera),
      materias (id, grado, seccion, carrera, nombre, profesor_id)
    `).eq('fecha', fecha);

    const filtrarPorProfesor = profesorEmail && profesorEmail !== 'all' && profesorEmail !== '';
    if (filtrarPorProfesor) {
      const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail);
      if (!idsMaterias || idsMaterias.length === 0) {
        const url = await subirExcelVacio('No hay asistencias para este profesor en esta fecha.');
        return res.json({ success: true, url });
      }
      queryAsistencias = queryAsistencias.in('materia_id', idsMaterias);
    }

    if (grado) queryAsistencias = queryAsistencias.filter('materias.grado', 'eq', grado);
    if (seccion) queryAsistencias = queryAsistencias.filter('materias.seccion', 'eq', seccion);

    const { data: asistencias, error: errAsistencias } = await queryAsistencias;
    if (errAsistencias) throw errAsistencias;

    const grupos = new Map();
    asistencias.forEach(asis => {
      const materia = asis.materias;
      if (!materia) return;
      if (!grupos.has(materia.id)) grupos.set(materia.id, { materia, asistencias: [] });
      grupos.get(materia.id).asistencias.push({ estudiante: asis.estudiantes, hora: asis.hora });
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Asistencia_${fecha}`);
    const headerStyle = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF8FF' } } };
    let currentRow = 1;

    const fechaLegible = new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Tegucigalpa'
    });

    worksheet.addRow([`Fecha: ${fechaLegible}`]);
    worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
    worksheet.getRow(currentRow).font = { bold: true, size: 13 };
    currentRow++;

    if (nombreProfesor) {
      worksheet.addRow([`Generado por: ${nombreProfesor}`]);
      worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
      worksheet.getRow(currentRow).font = { italic: true };
      currentRow++;
    }

    worksheet.addRow([]); currentRow++;

    if (grupos.size === 0) {
      worksheet.addRow(['No se registraron asistencias en esta fecha.']);
    } else {
      const gruposOrdenados = Array.from(grupos.values()).sort((a, b) => {
        if (a.materia.grado !== b.materia.grado) return String(a.materia.grado).localeCompare(String(b.materia.grado));
        return String(a.materia.seccion).localeCompare(String(b.materia.seccion));
      });

      for (const grupo of gruposOrdenados) {
        const mat = grupo.materia;
        worksheet.addRow([`${mat.nombre || mat.carrera || 'Clase'} - Grado ${mat.grado}° Sección ${mat.seccion}`]);
        worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
        const titleRow = worksheet.getRow(currentRow);
        titleRow.font = { bold: true, size: 12 };
        titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
        currentRow++;

        worksheet.addRow(['Cédula', 'Nombre', 'Apellido', 'Grado (Est.)', 'Sección (Est.)', 'Carrera', 'Hora de Escaneo']);
        worksheet.getRow(currentRow).eachCell(cell => { cell.style = headerStyle; });
        currentRow++;

        for (const item of grupo.asistencias) {
          const est = item.estudiante;
          worksheet.addRow([est?.cedula || '', est?.nombre || '', est?.apellido || '', est?.grado || '', est?.seccion || '', est?.carrera || '', item.hora || '']);
          currentRow++;
        }
        worksheet.addRow([]); currentRow++;
      }
    }

    [15, 20, 20, 12, 12, 20, 15, 15].forEach((w, i) => { if (worksheet.columns[i]) worksheet.columns[i].width = w; });

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `reporte_completo_${fecha}_${Date.now()}.xlsx`;
    const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
    try {
      await supabase.from('reportes_generados').insert([{
        fecha_inicio: fecha, fecha_fin: fecha, archivo_url: urlData.publicUrl,
        usuario: usuario || 'profesor', grado: grado || null, seccion: seccion || null,
      }]);
    } catch (e) { console.warn('⚠️ Metadata no guardada:', e.message); }

    res.json({ success: true, url: urlData.publicUrl });
  } catch (error) {
    console.error('❌ Error en reporte completo:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== LISTAR REPORTES GENERADOS ==========
const getReportesGenerados = async (req, res) => {
  const { data, error } = await supabase.from('reportes_generados').select('*').order('fecha_generacion', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// ========== ESTADÍSTICAS (CORREGIDO - usa profesor_asignaciones + materias) ==========
const getEstadisticas = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, profesorEmail } = req.query;
    console.log('📊 getEstadisticas - email:', profesorEmail, '| fechas:', fechaInicio, '-', fechaFin);

    let inicio, fin;
    if (fechaInicio && fechaFin) {
      inicio = fechaInicio; fin = fechaFin;
    } else {
      const hoy = new Date();
      inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
      fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }
    console.log('📅 Rango:', inicio, '->', fin);

    // 1. Obtener filtros
    const filtros = await obtenerFiltrosProfesor(profesorEmail);
    console.log('🎯 Filtros obtenidos:', JSON.stringify(filtros));

    // 2. Obtener estudiantes
    const estudiantes = await obtenerEstudiantesFiltrados(filtros);
    console.log('👥 Estudiantes encontrados:', estudiantes.length);

    if (estudiantes.length === 0) {
      console.log('⚠️ Sin estudiantes para este filtro, devolviendo vacío');
      return res.json({ masFaltas: [], mejorRecord: [], totalDias: 0, resumenGradoCarrera: [] });
    }

    // 3. Obtener asistencias
    let asistencias = [];
    const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail);
    console.log('📚 IDs de materias:', idsMaterias);

    if (idsMaterias === null) {
      const { data, error } = await supabase.from('asistencia')
        .select('cedula, fecha').gte('fecha', inicio).lte('fecha', fin);
      if (error) throw error;
      asistencias = data || [];
    } else if (idsMaterias.length > 0) {
      const { data, error } = await supabase.from('asistencia')
        .select('cedula, fecha').gte('fecha', inicio).lte('fecha', fin)
        .in('materia_id', idsMaterias);
      if (error) throw error;
      asistencias = data || [];
    }
    console.log('✅ Asistencias encontradas:', asistencias.length);

    const asistenciaCount = {};
    asistencias.forEach(a => { asistenciaCount[a.cedula] = (asistenciaCount[a.cedula] || 0) + 1; });

    const totalDias = Math.ceil((new Date(fin) - new Date(inicio)) / (1000 * 60 * 60 * 24)) + 1;

    const estadisticasArr = estudiantes.map(est => {
      const count = asistenciaCount[est.cedula] || 0;
      const faltas = totalDias - count;
      return { ...est, asistencias: count, faltas: faltas > 0 ? faltas : 0, totalDias };
    });

    const masFaltas = [...estadisticasArr].sort((a, b) => b.faltas - a.faltas).slice(0, 10);
    const mejorRecord = [...estadisticasArr].sort((a, b) => b.asistencias - a.asistencias).slice(0, 10);

    const resumenMap = {};
    estadisticasArr.forEach(est => {
      const key = `${est.grado}|${est.carrera || 'Sin carrera'}`;
      if (!resumenMap[key]) resumenMap[key] = { grado: est.grado, carrera: est.carrera || 'Sin carrera', totalAsistencias: 0, totalEstudiantes: 0 };
      resumenMap[key].totalAsistencias += est.asistencias;
      resumenMap[key].totalEstudiantes++;
    });

    const resumenGradoCarrera = Object.values(resumenMap).map(item => ({
      ...item, promedioAsistencias: (item.totalAsistencias / item.totalEstudiantes).toFixed(1)
    })).sort((a, b) => {
      if (String(a.grado) !== String(b.grado)) return String(a.grado).localeCompare(String(b.grado));
      return a.carrera.localeCompare(b.carrera);
    });

    res.json({ masFaltas, mejorRecord, totalDias, resumenGradoCarrera });
  } catch (error) {
    console.error('❌ Error en estadísticas:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== EXPORTAR ESTADÍSTICAS A EXCEL (CORREGIDO) ==========
const exportarEstadisticasExcel = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, profesorEmail } = req.query;
    let inicio, fin;
    if (fechaInicio && fechaFin) {
      inicio = fechaInicio; fin = fechaFin;
    } else {
      const hoy = new Date();
      inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
      fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }

    const filtros = await obtenerFiltrosProfesor(profesorEmail);
    const estudiantes = await obtenerEstudiantesFiltrados(filtros);

    let asistencias = [];
    const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail);
    if (idsMaterias === null) {
      const { data } = await supabase.from('asistencia').select('cedula, fecha').gte('fecha', inicio).lte('fecha', fin);
      asistencias = data || [];
    } else if (idsMaterias.length > 0) {
      const { data } = await supabase.from('asistencia').select('cedula, fecha')
        .gte('fecha', inicio).lte('fecha', fin).in('materia_id', idsMaterias);
      asistencias = data || [];
    }

    const asistenciaCount = {};
    asistencias.forEach(a => { asistenciaCount[a.cedula] = (asistenciaCount[a.cedula] || 0) + 1; });
    const totalDias = Math.ceil((new Date(fin) - new Date(inicio)) / (1000 * 60 * 60 * 24)) + 1;

    const estadisticasArr = estudiantes.map(est => {
      const count = asistenciaCount[est.cedula] || 0;
      const faltas = totalDias - count;
      return { ...est, asistencias: count, faltas: faltas > 0 ? faltas : 0, totalDias };
    });

    const masFaltas = [...estadisticasArr].sort((a, b) => b.faltas - a.faltas).slice(0, 10);
    const mejorRecord = [...estadisticasArr].sort((a, b) => b.asistencias - a.asistencias).slice(0, 10);

    const resumenMap = {};
    estadisticasArr.forEach(est => {
      const key = `${est.grado}|${est.carrera || 'Sin carrera'}`;
      if (!resumenMap[key]) resumenMap[key] = { grado: est.grado, carrera: est.carrera || 'Sin carrera', totalAsistencias: 0, totalEstudiantes: 0 };
      resumenMap[key].totalAsistencias += est.asistencias;
      resumenMap[key].totalEstudiantes++;
    });
    const resumenArray = Object.values(resumenMap).map(item => ({
      ...item, promedioAsistencias: (item.totalAsistencias / item.totalEstudiantes).toFixed(1)
    })).sort((a, b) => {
      if (String(a.grado) !== String(b.grado)) return String(a.grado).localeCompare(String(b.grado));
      return a.carrera.localeCompare(b.carrera);
    });

    const workbook = new ExcelJS.Workbook();
    const headerStyle = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF8FF' } } };
    const colsEst = [
      { header: 'Cédula', key: 'cedula', width: 15 }, { header: 'Nombre', key: 'nombre', width: 20 },
      { header: 'Apellido', key: 'apellido', width: 20 }, { header: 'Grado', key: 'grado', width: 8 },
      { header: 'Sección', key: 'seccion', width: 8 }, { header: 'Carrera', key: 'carrera', width: 20 },
      { header: 'Asistencias', key: 'asistencias', width: 12 }, { header: 'Faltas', key: 'faltas', width: 10 },
      { header: 'Total días', key: 'totalDias', width: 12 }
    ];

    const wsFaltas = workbook.addWorksheet('Más faltas');
    wsFaltas.columns = colsEst;
    wsFaltas.getRow(1).eachCell(cell => { cell.style = headerStyle; });
    masFaltas.forEach(est => wsFaltas.addRow(est));

    const wsRecord = workbook.addWorksheet('Mejor récord');
    wsRecord.columns = colsEst;
    wsRecord.getRow(1).eachCell(cell => { cell.style = headerStyle; });
    mejorRecord.forEach(est => wsRecord.addRow(est));

    const wsResumen = workbook.addWorksheet('Resumen por grado y carrera');
    wsResumen.columns = [
      { header: 'Grado', key: 'grado', width: 8 }, { header: 'Carrera', key: 'carrera', width: 20 },
      { header: 'Total asistencias', key: 'totalAsistencias', width: 18 },
      { header: 'Total estudiantes', key: 'totalEstudiantes', width: 18 },
      { header: 'Promedio asistencias', key: 'promedioAsistencias', width: 20 }
    ];
    wsResumen.getRow(1).eachCell(cell => { cell.style = headerStyle; });
    resumenArray.forEach(row => wsResumen.addRow(row));

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `estadisticas_${inicio}_a_${fin}_${Date.now()}.xlsx`;
    const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
    res.json({ success: true, url: urlData.publicUrl });
  } catch (error) {
    console.error('❌ Error exportando estadísticas:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  registrarAsistencia, getAsistenciaHoy, getAsistenciaByFecha, getAsistenciaPorGrado,
  limpiarAsistenciaHoy, getReporteAsistencia, exportarReporteExcel, exportarReporteCompletoExcel,
  getReportesGenerados, getEstadisticas, exportarEstadisticasExcel
};
