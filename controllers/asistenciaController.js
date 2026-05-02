const supabase = require('../config/supabase');
const ExcelJS = require('exceljs');

// ========== FUNCIÓN AUXILIAR PARA NORMALIZAR TEXTO (sin acentos, minúsculas) ==========
function normalizarTexto(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

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

// Registrar asistencia (con validación normalizada)
const registrarAsistencia = async (req, res) => {
  console.log('📥 POST /api/asistencia - Body:', req.body);
  const { cedula, materiaId } = req.body;

  if (!cedula) {
    console.log('❌ Cédula no proporcionada');
    return res.status(400).json({ error: 'Cédula no proporcionada' });
  }
  if (!materiaId) {
    console.log('❌ Materia no especificada');
    return res.status(400).json({ error: 'Debe especificar la materia/clase' });
  }

  // 1. Obtener datos de la materia (grado, carrera)
  const { data: materia, error: errMateria } = await supabase
    .from('materias')
    .select('grado, carrera')
    .eq('id', materiaId)
    .single();

  if (errMateria || !materia) {
    console.log('❌ Materia no encontrada');
    return res.status(404).json({ error: 'La clase seleccionada no existe' });
  }

  // 2. Obtener datos del estudiante
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
  console.log('📚 Materia requerida: grado', materia.grado, 'carrera', materia.carrera);

  // 3. Validar normalizada (sin acentos, minúsculas)
  const gradoMateria = normalizarTexto(materia.grado);
  const carreraMateria = normalizarTexto(materia.carrera);
  const gradoEstudiante = normalizarTexto(estudiante.grado);
  const carreraEstudiante = normalizarTexto(estudiante.carrera);

  if (gradoEstudiante !== gradoMateria || carreraEstudiante !== carreraMateria) {
    console.log(`❌ Validación fallida. Materia: (${gradoMateria}, ${carreraMateria}) vs Estudiante: (${gradoEstudiante}, ${carreraEstudiante})`);
    return res.status(400).json({
      error: `Este estudiante no pertenece a esta clase. Solo se permite para grado ${materia.grado} - ${materia.carrera}.`
    });
  }

  const hoy = new Date().toISOString().split('T')[0];
  const ahora = new Date().toLocaleTimeString('en-GB', { hour12: false });

  // 4. Verificar si ya registró asistencia hoy
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

  // 5. Insertar asistencia
  console.log(`📝 Insertando asistencia para ${cedula} en fecha ${hoy} hora ${ahora} con materia ${materiaId}`);
  const { error: errAsistencia } = await supabase
    .from('asistencia')
    .insert([{ cedula, fecha: hoy, hora: ahora, materia_id: materiaId }]);

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

// Obtener asistencia del día (FILTRADA POR PROFESOR)
const getAsistenciaHoy = async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const añoActual = new Date().getFullYear();
  const mesActual = new Date().getMonth() + 1;
  const { profesorEmail } = req.query;

  if (!profesorEmail) {
    console.log('❌ No se proporcionó email del profesor');
    return res.status(400).json({ error: 'Se necesita el email del profesor' });
  }

  console.log(`📋 Obteniendo asistencia del día: ${hoy} para profesor: ${profesorEmail}`);

  const { data: profesor, error: errProf } = await supabase
    .from('profesores')
    .select('id')
    .eq('email', profesorEmail)
    .single();

  if (errProf || !profesor) {
    console.log('❌ Profesor no encontrado');
    return res.status(404).json({ error: 'Profesor no encontrado' });
  }

  const { data: materias, error: errMats } = await supabase
    .from('materias')
    .select('id')
    .eq('profesor_id', profesor.id);

  if (errMats || !materias || materias.length === 0) {
    console.log('⚠️ El profesor no tiene materias asignadas');
    return res.json([]);
  }

  const idsMaterias = materias.map(m => m.id);
  console.log(`📚 Materias del profesor: ${idsMaterias.join(', ')}`);

  const { data, error } = await supabase
    .from('asistencia')
    .select(`
      id,
      fecha,
      hora,
      materia_id,
      estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url),
      materias (nombre)
    `)
    .eq('fecha', hoy)
    .in('materia_id', idsMaterias);

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
      materia_nombre: item.materias?.nombre || 'Sin materia',
      faltasEnMes: faltas
    };
  }));

  console.log(`✅ Encontrados ${asistenciaConFaltas.length} registros para el profesor`);
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
  if (grado) filtrados = filtrados.filter(a => a.estudiantes?.grado === grado);
  if (seccion) filtrados = filtrados.filter(a => a.estudiantes?.seccion === seccion);
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

// ========== REPORTE POR RANGO DE FECHAS (JSON) - INCLUYE MATERIA Y FILTRADO POR PROFESOR ==========
const getReporteAsistencia = async (req, res) => {
  const { fechaInicio, fechaFin, profesorEmail } = req.query;
  console.log(`📊 Reporte JSON - Desde: ${fechaInicio}, Hasta: ${fechaFin}, Profesor: ${profesorEmail || 'todos'}`);

  let query = supabase
    .from('asistencia')
    .select(`
      id,
      fecha,
      hora,
      materia_id,
      estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url),
      materias (nombre, grado, seccion, carrera, profesor_id)
    `);

  if (fechaInicio && fechaFin) {
    query = query.gte('fecha', fechaInicio).lte('fecha', fechaFin);
  } else if (fechaInicio) {
    query = query.gte('fecha', fechaInicio);
  } else if (fechaFin) {
    query = query.lte('fecha', fechaFin);
  }

  // Filtrar por profesor si se proporciona un email válido y no es "all" o vacío
  if (profesorEmail && profesorEmail !== 'all' && profesorEmail !== '') {
    const { data: profesor, error: errProf } = await supabase
      .from('profesores')
      .select('id')
      .eq('email', profesorEmail)
      .single();
    if (!errProf && profesor) {
      const { data: materias, error: errMat } = await supabase
        .from('materias')
        .select('id')
        .eq('profesor_id', profesor.id);
      if (!errMat && materias && materias.length > 0) {
        const idsMaterias = materias.map(m => m.id);
        query = query.in('materia_id', idsMaterias);
      } else {
        return res.json([]);
      }
    } else {
      return res.status(404).json({ error: 'Profesor no encontrado' });
    }
  }

  const { data, error } = await query.order('fecha', { ascending: false });
  if (error) {
    console.log('❌ Error en reporte:', error.message);
    return res.status(400).json({ error: error.message });
  }

  const resultados = data.map(item => ({
    ...item,
    materia_nombre: item.materias?.nombre || 'Sin materia'
  }));
  res.json(resultados);
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

// Exportar reporte completo (asistencias agrupadas por CLASE, mostrando grado/sección de la materia)
const exportarReporteCompletoExcel = async (req, res) => {
  const { fecha, usuario, nombreProfesor, grado, seccion, profesorEmail } = req.query;
  if (!fecha) {
    return res.status(400).json({ error: 'Debe proporcionar una fecha (YYYY-MM-DD)' });
  }
  console.log(`📊 Exportando reporte completo - Fecha: ${fecha}, Usuario: ${usuario || 'anon'}, Nombre: ${nombreProfesor || 'No especificado'}, Grado: ${grado || 'todos'}, Sección: ${seccion || 'todas'}, ProfesorEmail: ${profesorEmail || 'todos'}`);
  try {
    let queryAsistencias = supabase
      .from('asistencia')
      .select(`
        cedula,
        hora,
        materia_id,
        estudiantes (cedula, nombre, apellido, grado, seccion, carrera),
        materias (id, grado, seccion, carrera, nombre, profesor_id)
      `)
      .eq('fecha', fecha);

    // CORRECCIÓN: solo aplicar filtro de profesor si profesorEmail existe y no es "all" ni cadena vacía
    const filtrarPorProfesor = profesorEmail && profesorEmail !== 'all' && profesorEmail !== '';
    if (filtrarPorProfesor) {
      const { data: profesor, error: errProf } = await supabase
        .from('profesores')
        .select('id')
        .eq('email', profesorEmail)
        .single();
      if (errProf || !profesor) {
        console.error('❌ Profesor no encontrado:', profesorEmail);
        // Devolver Excel vacío con mensaje
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(`Asistencia_${fecha}`);
        worksheet.addRow([`Error: No se encontró al profesor con email ${profesorEmail}`]);
        const buffer = await workbook.xlsx.writeBuffer();
        const fileName = `reporte_completo_error_${fecha}_${Date.now()}.xlsx`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('reportes')
          .upload(fileName, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
        return res.json({ success: true, url: urlData.publicUrl });
      }
      const { data: materias, error: errMat } = await supabase
        .from('materias')
        .select('id')
        .eq('profesor_id', profesor.id);
      if (errMat || !materias || materias.length === 0) {
        // No tiene materias, devolver Excel vacío
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(`Asistencia_${fecha}`);
        worksheet.addRow(['No se encontraron asistencias para este profesor en la fecha indicada.']);
        const buffer = await workbook.xlsx.writeBuffer();
        const fileName = `reporte_completo_vacio_${fecha}_${Date.now()}.xlsx`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('reportes')
          .upload(fileName, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
        return res.json({ success: true, url: urlData.publicUrl });
      }
      const idsMaterias = materias.map(m => m.id);
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
      const key = materia.id;
      if (!grupos.has(key)) {
        grupos.set(key, { materia, asistencias: [] });
      }
      grupos.get(key).asistencias.push({
        estudiante: asis.estudiantes,
        hora: asis.hora
      });
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Asistencia_${fecha}`);
    const headerStyle = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF8FF' } } };
    let currentRow = 1;

    const fechaObj = new Date(fecha + 'T12:00:00');
    const fechaLegible = fechaObj.toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/Tegucigalpa'
    });
    worksheet.addRow([`Fecha: ${fechaLegible}`]).mergeCells(`A${currentRow}:H${currentRow}`);
    currentRow++;
    if (nombreProfesor) {
      worksheet.addRow([`Generado por: ${nombreProfesor}`]).mergeCells(`A${currentRow}:H${currentRow}`);
      currentRow++;
    }
    worksheet.addRow([]);
    currentRow++;

    if (grupos.size === 0) {
      worksheet.addRow(['No se registraron asistencias en esta fecha para las clases seleccionadas.']);
    } else {
      const gruposOrdenados = Array.from(grupos.values()).sort((a, b) => {
        if (a.materia.grado !== b.materia.grado) return a.materia.grado.localeCompare(b.materia.grado);
        return a.materia.seccion.localeCompare(b.materia.seccion);
      });

      for (const grupo of gruposOrdenados) {
        const materia = grupo.materia;
        const tituloClase = `${materia.nombre || materia.carrera || 'Clase'} - Grado ${materia.grado}° Sección ${materia.seccion}`;
        const titleRow = worksheet.addRow([tituloClase]);
        worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
        titleRow.font = { bold: true, size: 12 };
        titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
        currentRow++;

        const headerRow = worksheet.addRow(['Cédula', 'Nombre', 'Apellido', 'Grado (Est.)', 'Sección (Est.)', 'Carrera', 'Hora de Escaneo']);
        headerRow.eachCell(cell => { cell.style = headerStyle; });
        currentRow++;

        for (const item of grupo.asistencias) {
          const est = item.estudiante;
          worksheet.addRow([
            est?.cedula || '',
            est?.nombre || '',
            est?.apellido || '',
            est?.grado || '',
            est?.seccion || '',
            est?.carrera || '',
            item.hora || ''
          ]);
          currentRow++;
        }
        worksheet.addRow([]);
        currentRow++;
      }
    }

    worksheet.columns.forEach((col, idx) => {
      if (idx === 0) col.width = 15;
      else if (idx === 1) col.width = 20;
      else if (idx === 2) col.width = 20;
      else if (idx === 3) col.width = 12;
      else if (idx === 4) col.width = 12;
      else if (idx === 5) col.width = 20;
      else if (idx === 6) col.width = 15;
      else col.width = 15;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `reporte_completo_por_clase_${fecha}_${Date.now()}.xlsx`;
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
    console.error('❌ Error en reporte completo por clase:', error);
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

// ========== ESTADÍSTICAS DE ASISTENCIA (JSON) CON FILTRO POR PROFESOR ==========
const getEstadisticas = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, profesorEmail } = req.query;
    let inicio, fin;
    if (fechaInicio && fechaFin) {
      inicio = fechaInicio;
      fin = fechaFin;
    } else {
      const hoy = new Date();
      inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
      fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }

    let filtrosGradoCarrera = [];
    if (profesorEmail) {
      const { data: profesor, error: errProf } = await supabase
        .from('profesores')
        .select('id')
        .eq('email', profesorEmail)
        .single();
      if (!errProf && profesor) {
        const { data: asignaciones, error: errAsig } = await supabase
          .from('profesor_asignaciones')
          .select('grado, carrera')
          .eq('profesor_id', profesor.id);
        if (!errAsig && asignaciones) {
          filtrosGradoCarrera = asignaciones;
        }
      }
    }

    let queryEstudiantes = supabase
      .from('estudiantes')
      .select('cedula, nombre, apellido, grado, seccion, carrera')
      .order('apellido', { ascending: true });

    if (filtrosGradoCarrera.length > 0) {
      const conditions = filtrosGradoCarrera.map(f => `(grado.eq.${f.grado},carrera.eq.${f.carrera})`).join(',');
      queryEstudiantes = queryEstudiantes.or(conditions);
    }

    const { data: estudiantes, error: errEst } = await queryEstudiantes;
    if (errEst) throw errEst;

    const { data: asistencias, error: errAsis } = await supabase
      .from('asistencia')
      .select('cedula, fecha')
      .gte('fecha', inicio)
      .lte('fecha', fin);
    if (errAsis) throw errAsis;

    const asistenciaCount = {};
    asistencias.forEach(a => {
      asistenciaCount[a.cedula] = (asistenciaCount[a.cedula] || 0) + 1;
    });

    const startDate = new Date(inicio);
    const endDate = new Date(fin);
    const totalDias = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

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

    const masFaltas = [...estadisticas].sort((a, b) => b.faltas - a.faltas).slice(0, 10);
    const mejorRecord = [...estadisticas].sort((a, b) => b.asistencias - a.asistencias).slice(0, 10);

    const resumenGradoCarrera = {};
    estadisticas.forEach(est => {
      const key = `${est.grado}|${est.carrera || 'Sin carrera'}`;
      if (!resumenGradoCarrera[key]) {
        resumenGradoCarrera[key] = {
          grado: est.grado,
          carrera: est.carrera || 'Sin carrera',
          totalAsistencias: 0,
          totalEstudiantes: 0
        };
      }
      resumenGradoCarrera[key].totalAsistencias += est.asistencias;
      resumenGradoCarrera[key].totalEstudiantes++;
    });
    const resumenArray = Object.values(resumenGradoCarrera).map(item => ({
      grado: item.grado,
      carrera: item.carrera,
      totalAsistencias: item.totalAsistencias,
      totalEstudiantes: item.totalEstudiantes,
      promedioAsistencias: (item.totalAsistencias / item.totalEstudiantes).toFixed(1)
    })).sort((a, b) => {
      if (a.grado !== b.grado) return a.grado.localeCompare(b.grado);
      return a.carrera.localeCompare(b.carrera);
    });

    res.json({ masFaltas, mejorRecord, totalDias, resumenGradoCarrera: resumenArray });
  } catch (error) {
    console.error('❌ Error en estadísticas:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== EXPORTAR ESTADÍSTICAS A EXCEL (CON FILTRO POR PROFESOR) ==========
const exportarEstadisticasExcel = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, profesorEmail } = req.query;
    let inicio, fin;
    if (fechaInicio && fechaFin) {
      inicio = fechaInicio;
      fin = fechaFin;
    } else {
      const hoy = new Date();
      inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
      fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }

    let filtrosGradoCarrera = [];
    if (profesorEmail) {
      const { data: profesor, error: errProf } = await supabase
        .from('profesores')
        .select('id')
        .eq('email', profesorEmail)
        .single();
      if (!errProf && profesor) {
        const { data: asignaciones, error: errAsig } = await supabase
          .from('profesor_asignaciones')
          .select('grado, carrera')
          .eq('profesor_id', profesor.id);
        if (!errAsig && asignaciones) {
          filtrosGradoCarrera = asignaciones;
        }
      }
    }

    let queryEstudiantes = supabase
      .from('estudiantes')
      .select('cedula, nombre, apellido, grado, seccion, carrera')
      .order('apellido', { ascending: true });

    if (filtrosGradoCarrera.length > 0) {
      const conditions = filtrosGradoCarrera.map(f => `(grado.eq.${f.grado},carrera.eq.${f.carrera})`).join(',');
      queryEstudiantes = queryEstudiantes.or(conditions);
    }

    const { data: estudiantes, error: errEst } = await queryEstudiantes;
    if (errEst) throw errEst;

    const { data: asistencias, error: errAsis } = await supabase
      .from('asistencia')
      .select('cedula, fecha')
      .gte('fecha', inicio)
      .lte('fecha', fin);
    if (errAsis) throw errAsis;

    const asistenciaCount = {};
    asistencias.forEach(a => {
      asistenciaCount[a.cedula] = (asistenciaCount[a.cedula] || 0) + 1;
    });

    const startDate = new Date(inicio);
    const endDate = new Date(fin);
    const totalDias = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

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

    const masFaltas = [...estadisticas].sort((a, b) => b.faltas - a.faltas).slice(0, 10);
    const mejorRecord = [...estadisticas].sort((a, b) => b.asistencias - a.asistencias).slice(0, 10);

    const resumenGradoCarrera = {};
    estadisticas.forEach(est => {
      const key = `${est.grado}|${est.carrera || 'Sin carrera'}`;
      if (!resumenGradoCarrera[key]) {
        resumenGradoCarrera[key] = {
          grado: est.grado,
          carrera: est.carrera || 'Sin carrera',
          totalAsistencias: 0,
          totalEstudiantes: 0
        };
      }
      resumenGradoCarrera[key].totalAsistencias += est.asistencias;
      resumenGradoCarrera[key].totalEstudiantes++;
    });
    const resumenArray = Object.values(resumenGradoCarrera).map(item => ({
      grado: item.grado,
      carrera: item.carrera,
      totalAsistencias: item.totalAsistencias,
      totalEstudiantes: item.totalEstudiantes,
      promedioAsistencias: (item.totalAsistencias / item.totalEstudiantes).toFixed(1)
    })).sort((a, b) => {
      if (a.grado !== b.grado) return a.grado.localeCompare(b.grado);
      return a.carrera.localeCompare(b.carrera);
    });

    const workbook = new ExcelJS.Workbook();
    const headerStyle = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF8FF' } } };

    const wsFaltas = workbook.addWorksheet('Más faltas');
    wsFaltas.columns = [
      { header: 'Cédula', key: 'cedula', width: 15 },
      { header: 'Nombre', key: 'nombre', width: 20 },
      { header: 'Apellido', key: 'apellido', width: 20 },
      { header: 'Grado', key: 'grado', width: 8 },
      { header: 'Sección', key: 'seccion', width: 8 },
      { header: 'Carrera', key: 'carrera', width: 20 },
      { header: 'Asistencias', key: 'asistencias', width: 12 },
      { header: 'Faltas', key: 'faltas', width: 10 },
      { header: 'Total días', key: 'totalDias', width: 12 }
    ];
    wsFaltas.getRow(1).eachCell(cell => cell.style = headerStyle);
    masFaltas.forEach(est => wsFaltas.addRow(est));

    const wsRecord = workbook.addWorksheet('Mejor récord');
    wsRecord.columns = wsFaltas.columns;
    wsRecord.getRow(1).eachCell(cell => cell.style = headerStyle);
    mejorRecord.forEach(est => wsRecord.addRow(est));

    const wsResumen = workbook.addWorksheet('Resumen por grado y carrera');
    wsResumen.columns = [
      { header: 'Grado', key: 'grado', width: 8 },
      { header: 'Carrera', key: 'carrera', width: 20 },
      { header: 'Total asistencias', key: 'totalAsistencias', width: 18 },
      { header: 'Total estudiantes', key: 'totalEstudiantes', width: 18 },
      { header: 'Promedio asistencias', key: 'promedioAsistencias', width: 20 }
    ];
    wsResumen.getRow(1).eachCell(cell => cell.style = headerStyle);
    resumenArray.forEach(row => wsResumen.addRow(row));

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `estadisticas_asistencia_${inicio}_a_${fin}_${Date.now()}.xlsx`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('reportes')
      .upload(fileName, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
    const archivo_url = urlData.publicUrl;

    res.json({ success: true, url: archivo_url });
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
  exportarEstadisticasExcel
};
