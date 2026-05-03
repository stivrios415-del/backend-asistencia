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
async function obtenerFiltrosProfesor(profesorEmail) {
  if (!profesorEmail || profesorEmail === 'all' || profesorEmail === '') return null;

  console.log('🔍 Buscando profesor con email:', profesorEmail);

  const { data: profesor, error: errProf } = await supabase
    .from('profesores').select('id, nombre').eq('email', profesorEmail.trim().toLowerCase()).single();

  let profesorFinal = profesor;
  if (errProf || !profesor) {
    console.log('⚠️ No encontrado con lowercase, intentando sin transformar...');
    const { data: p2 } = await supabase
      .from('profesores').select('id, nombre').eq('email', profesorEmail.trim()).single();
    profesorFinal = p2;
  }

  if (!profesorFinal) {
    console.error('❌ Profesor no encontrado para email:', profesorEmail);
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

  if (filtros === null) return data;
  if (filtros.length === 0) return [];

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
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Hora', key: 'hora', width: 10 },
    { header: 'Cédula', key: 'cedula', width: 15 },
    { header: 'Nombre', key: 'nombre', width: 20 },
    { header: 'Apellido', key: 'apellido', width: 20 },
    { header: 'Grado', key: 'grado', width: 8 },
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
    await supabase.storage.from('reportes').upload(fn, buf, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
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
    const headerStyle = {
      font: { bold: true },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF8FF' } }
    };
    let currentRow = 1;

    const fechaLegible = new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'America/Tegucigalpa'
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
        if (a.materia.grado !== b.materia.grado)
          return String(a.materia.grado).localeCompare(String(b.materia.grado));
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
          worksheet.addRow([
            est?.cedula || '', est?.nombre || '', est?.apellido || '',
            est?.grado || '', est?.seccion || '', est?.carrera || '', item.hora || ''
          ]);
          currentRow++;
        }
        worksheet.addRow([]); currentRow++;
      }
    }

    [15, 20, 20, 12, 12, 20, 15, 15].forEach((w, i) => {
      if (worksheet.columns[i]) worksheet.columns[i].width = w;
    });

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
  const { data, error } = await supabase
    .from('reportes_generados').select('*').order('fecha_generacion', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// ========== ESTADÍSTICAS ==========
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

    const filtros = await obtenerFiltrosProfesor(profesorEmail);
    console.log('🎯 Filtros obtenidos:', JSON.stringify(filtros));

    const estudiantes = await obtenerEstudiantesFiltrados(filtros);
    console.log('👥 Estudiantes encontrados:', estudiantes.length);

    if (estudiantes.length === 0) {
      console.log('⚠️ Sin estudiantes para este filtro, devolviendo vacío');
      return res.json({ masFaltas: [], mejorRecord: [], totalDias: 0, resumenGradoCarrera: [] });
    }

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
      if (!resumenMap[key]) resumenMap[key] = {
        grado: est.grado, carrera: est.carrera || 'Sin carrera',
        totalAsistencias: 0, totalEstudiantes: 0
      };
      resumenMap[key].totalAsistencias += est.asistencias;
      resumenMap[key].totalEstudiantes++;
    });

    const resumenGradoCarrera = Object.values(resumenMap).map(item => ({
      ...item,
      promedioAsistencias: (item.totalAsistencias / item.totalEstudiantes).toFixed(1)
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

// ========== EXPORTAR ESTADÍSTICAS A EXCEL ==========
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
      const { data } = await supabase.from('asistencia')
        .select('cedula, fecha').gte('fecha', inicio).lte('fecha', fin);
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
      if (!resumenMap[key]) resumenMap[key] = {
        grado: est.grado, carrera: est.carrera || 'Sin carrera',
        totalAsistencias: 0, totalFaltas: 0, totalEstudiantes: 0
      };
      resumenMap[key].totalAsistencias += est.asistencias;
      resumenMap[key].totalFaltas += est.faltas;
      resumenMap[key].totalEstudiantes++;
    });
    const resumenArray = Object.values(resumenMap).map(item => ({
      ...item,
      promedioAsistencias: item.totalEstudiantes > 0
        ? (item.totalAsistencias / item.totalEstudiantes).toFixed(1) : '0'
    })).sort((a, b) => {
      if (String(a.grado) !== String(b.grado)) return String(a.grado).localeCompare(String(b.grado));
      return a.carrera.localeCompare(b.carrera);
    });

    // ── Estilos reutilizables ─────────────────────────────────────────────────
    const headerStyle = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143C65' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
      }
    };
    const dataStyle = {
      border: {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      }
    };
    const altRowStyle = {
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } },
      border: dataStyle.border
    };

    const colsEst = [
      { header: 'Cédula', key: 'cedula', width: 16 },
      { header: 'Nombre', key: 'nombre', width: 22 },
      { header: 'Apellido', key: 'apellido', width: 22 },
      { header: 'Grado', key: 'grado', width: 8 },
      { header: 'Sección', key: 'seccion', width: 10 },
      { header: 'Carrera', key: 'carrera', width: 20 },
      { header: 'Asistencias', key: 'asistencias', width: 13 },
      { header: 'Faltas', key: 'faltas', width: 10 },
      { header: 'Total días', key: 'totalDias', width: 12 }
    ];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sistema de Asistencia';
    workbook.created = new Date();

    // ── Hoja 1: Dashboard ─────────────────────────────────────────────────────
    const wsDash = workbook.addWorksheet('Dashboard');
    wsDash.views = [{ showGridLines: false }];

    wsDash.mergeCells('A1:I1');
    const titleCell = wsDash.getCell('A1');
    titleCell.value = `ESTADÍSTICAS DE ASISTENCIA — ${inicio} al ${fin}`;
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143C65' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    wsDash.getRow(1).height = 35;

    wsDash.mergeCells('A2:I2');
    const subCell = wsDash.getCell('A2');
    subCell.value = `Total estudiantes: ${estudiantes.length}  |  Total días: ${totalDias}  |  Total asistencias: ${asistencias.length}`;
    subCell.font = { size: 11, color: { argb: 'FFFFFFFF' }, italic: true };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF256D5B' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    wsDash.getRow(2).height = 22;

    wsDash.addRow([]);

    // Encabezados tabla resumen (fila 4)
    ['A4','B4','C4','D4','E4'].forEach((addr, i) => {
      const headers = ['Grado / Carrera', 'Total Asistencias', 'Total Faltas', 'Promedio Asist.', 'Total Estudiantes'];
      wsDash.getCell(addr).value = headers[i];
      wsDash.getCell(addr).style = headerStyle;
    });
    wsDash.getRow(4).height = 20;

    let fila = 5;
    resumenArray.forEach((item, idx) => {
      const etiqueta = `${item.grado}° ${item.carrera}`;
      wsDash.getCell(`A${fila}`).value = etiqueta;
      wsDash.getCell(`B${fila}`).value = item.totalAsistencias;
      wsDash.getCell(`C${fila}`).value = item.totalFaltas;
      wsDash.getCell(`D${fila}`).value = parseFloat(item.promedioAsistencias);
      wsDash.getCell(`E${fila}`).value = item.totalEstudiantes;
      const rowStyle = idx % 2 === 0 ? dataStyle : altRowStyle;
      ['A','B','C','D','E'].forEach(col => { wsDash.getCell(`${col}${fila}`).style = rowStyle; });
      fila++;
    });

    wsDash.getColumn('A').width = 25;
    wsDash.getColumn('B').width = 20;
    wsDash.getColumn('C').width = 15;
    wsDash.getColumn('D').width = 18;
    wsDash.getColumn('E').width = 18;

    const lastDataRow = fila - 1;

    // Gráfica de barras: Asistencias vs Faltas
    if (resumenArray.length > 0) {
      const chartBar = workbook.addChart('bar', 'clustered');
      chartBar.title = { name: 'Asistencias vs Faltas por Grado y Carrera' };
      chartBar.style = 10;
      chartBar.displayBlanksAs = 'zero';
      chartBar.addSeries({
        name: { formula: `'Dashboard'!$B$4` },
        categories: { formula: `'Dashboard'!$A$5:$A$${lastDataRow}` },
        values: { formula: `'Dashboard'!$B$5:$B$${lastDataRow}` },
        fill: { type: 'solid', color: '143C65' }
      });
      chartBar.addSeries({
        name: { formula: `'Dashboard'!$C$4` },
        categories: { formula: `'Dashboard'!$A$5:$A$${lastDataRow}` },
        values: { formula: `'Dashboard'!$C$5:$C$${lastDataRow}` },
        fill: { type: 'solid', color: 'E53E3E' }
      });
      chartBar.plotArea = {
        valAxis: [{ title: 'Cantidad' }],
        catAxis: [{ title: 'Grado / Carrera' }]
      };
      chartBar.legend = { position: 'bottom' };
      wsDash.addChart(chartBar, 'G4:O20');
    }

    // Gráfica de pastel: Distribución por carrera
    if (resumenArray.length > 0) {
      const chartPie = workbook.addChart('pie', 'pie');
      chartPie.title = { name: 'Distribución de Asistencias por Carrera' };
      chartPie.style = 26;
      chartPie.displayBlanksAs = 'zero';
      chartPie.addSeries({
        name: 'Asistencias',
        categories: { formula: `'Dashboard'!$A$5:$A$${lastDataRow}` },
        values: { formula: `'Dashboard'!$B$5:$B$${lastDataRow}` },
        dataLabels: { showPercent: true, showCatName: true, separator: '\n' }
      });
      chartPie.legend = { position: 'right' };
      wsDash.addChart(chartPie, 'G22:O38');
    }

    // ── Hoja 2: Más faltas ────────────────────────────────────────────────────
    const wsFaltas = workbook.addWorksheet('Mas faltas');
    wsFaltas.views = [{ showGridLines: false }];
    wsFaltas.mergeCells('A1:I1');
    const faltasTitleCell = wsFaltas.getCell('A1');
    faltasTitleCell.value = 'TOP 10 — ALUMNOS CON MÁS FALTAS';
    faltasTitleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    faltasTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE53E3E' } };
    faltasTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    wsFaltas.getRow(1).height = 28;
    wsFaltas.addRow([]);

    wsFaltas.columns = colsEst;
    wsFaltas.getRow(3).values = colsEst.map(c => c.header);
    wsFaltas.getRow(3).eachCell(cell => { cell.style = headerStyle; });
    wsFaltas.getRow(3).height = 20;

    masFaltas.forEach((est, idx) => {
      const r = wsFaltas.addRow([
        est.cedula, est.nombre, est.apellido, est.grado,
        est.seccion, est.carrera, est.asistencias, est.faltas, est.totalDias
      ]);
      r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; });
      if (est.faltas >= 3) r.getCell(8).font = { bold: true, color: { argb: 'FFCC0000' } };
    });

    if (masFaltas.length > 0) {
      const faltasDataStart = 4;
      const faltasDataEnd = faltasDataStart + masFaltas.length - 1;
      const chartFaltas = workbook.addChart('bar', 'clustered');
      chartFaltas.title = { name: 'Top 10 Alumnos con Más Faltas' };
      chartFaltas.style = 10;
      chartFaltas.addSeries({
        name: 'Faltas',
        categories: { formula: `'Mas faltas'!$B$${faltasDataStart}:$B$${faltasDataEnd}` },
        values: { formula: `'Mas faltas'!$H$${faltasDataStart}:$H$${faltasDataEnd}` },
        fill: { type: 'solid', color: 'E53E3E' }
      });
      chartFaltas.addSeries({
        name: 'Asistencias',
        categories: { formula: `'Mas faltas'!$B$${faltasDataStart}:$B$${faltasDataEnd}` },
        values: { formula: `'Mas faltas'!$G$${faltasDataStart}:$G$${faltasDataEnd}` },
        fill: { type: 'solid', color: '143C65' }
      });
      chartFaltas.legend = { position: 'bottom' };
      wsFaltas.addChart(chartFaltas, 'A15:I30');
    }

    // ── Hoja 3: Mejor récord ──────────────────────────────────────────────────
    const wsRecord = workbook.addWorksheet('Mejor record');
    wsRecord.views = [{ showGridLines: false }];
    wsRecord.mergeCells('A1:I1');
    const recordTitleCell = wsRecord.getCell('A1');
    recordTitleCell.value = 'TOP 10 — ALUMNOS CON MEJOR RÉCORD DE ASISTENCIA';
    recordTitleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    recordTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF256D5B' } };
    recordTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    wsRecord.getRow(1).height = 28;
    wsRecord.addRow([]);

    wsRecord.columns = colsEst;
    wsRecord.getRow(3).values = colsEst.map(c => c.header);
    wsRecord.getRow(3).eachCell(cell => { cell.style = headerStyle; });
    wsRecord.getRow(3).height = 20;

    mejorRecord.forEach((est, idx) => {
      const r = wsRecord.addRow([
        est.cedula, est.nombre, est.apellido, est.grado,
        est.seccion, est.carrera, est.asistencias, est.faltas, est.totalDias
      ]);
      r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; });
      r.getCell(7).font = { bold: true, color: { argb: 'FF256D5B' } };
    });

    if (mejorRecord.length > 0) {
      const recDataStart = 4;
      const recDataEnd = recDataStart + mejorRecord.length - 1;
      const chartRecord = workbook.addChart('bar', 'clustered');
      chartRecord.title = { name: 'Top 10 Alumnos con Mejor Récord' };
      chartRecord.style = 10;
      chartRecord.addSeries({
        name: 'Asistencias',
        categories: { formula: `'Mejor record'!$B$${recDataStart}:$B$${recDataEnd}` },
        values: { formula: `'Mejor record'!$G$${recDataStart}:$G$${recDataEnd}` },
        fill: { type: 'solid', color: '256D5B' }
      });
      chartRecord.legend = { position: 'bottom' };
      wsRecord.addChart(chartRecord, 'A15:I30');
    }

    // ── Hoja 4: Resumen por grado ─────────────────────────────────────────────
    const wsResumen = workbook.addWorksheet('Resumen');
    wsResumen.views = [{ showGridLines: false }];
    wsResumen.mergeCells('A1:F1');
    const resumenTitleCell = wsResumen.getCell('A1');
    resumenTitleCell.value = 'RESUMEN POR GRADO Y CARRERA';
    resumenTitleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    resumenTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143C65' } };
    resumenTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    wsResumen.getRow(1).height = 28;
    wsResumen.addRow([]);

    wsResumen.columns = [
      { header: 'Grado', key: 'grado', width: 10 },
      { header: 'Carrera', key: 'carrera', width: 22 },
      { header: 'Total asistencias', key: 'totalAsistencias', width: 20 },
      { header: 'Total faltas', key: 'totalFaltas', width: 15 },
      { header: 'Total estudiantes', key: 'totalEstudiantes', width: 20 },
      { header: 'Promedio asistencias', key: 'promedioAsistencias', width: 22 }
    ];
    wsResumen.getRow(3).values = [
      'Grado', 'Carrera', 'Total asistencias',
      'Total faltas', 'Total estudiantes', 'Promedio asistencias'
    ];
    wsResumen.getRow(3).eachCell(cell => { cell.style = headerStyle; });
    wsResumen.getRow(3).height = 20;

    resumenArray.forEach((item, idx) => {
      const r = wsResumen.addRow([
        item.grado, item.carrera, item.totalAsistencias,
        item.totalFaltas, item.totalEstudiantes, parseFloat(item.promedioAsistencias)
      ]);
      r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; });
    });

    // ── Subir y responder ─────────────────────────────────────────────────────
    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `estadisticas_${inicio}_a_${fin}_${Date.now()}.xlsx`;
    const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
    console.log('✅ Excel con gráficas generado:', fileName);
    res.json({ success: true, url: urlData.publicUrl });
  } catch (error) {
    console.error('❌ Error exportando estadísticas:', error);
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
  getEstadisticas,
  exportarEstadisticasExcel,
};
