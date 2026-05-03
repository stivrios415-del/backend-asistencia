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
  const diasTotales =
    Math.ceil((new Date(ultimoDia) - new Date(primerDia)) / (1000 * 60 * 60 * 24)) + 1;
  const faltas = diasTotales - data.length;
  return faltas > 0 ? faltas : 0;
}

// ========== HELPER: filtros grado/carrera del profesor ==========
async function obtenerFiltrosProfesor(profesorEmail) {
  if (!profesorEmail || profesorEmail === 'all' || profesorEmail === '') return null;
  console.log('🔍 Buscando profesor con email:', profesorEmail);

  let { data: profesor } = await supabase
    .from('profesores').select('id, nombre')
    .eq('email', profesorEmail.trim().toLowerCase()).single();

  if (!profesor) {
    const { data: p2 } = await supabase
      .from('profesores').select('id, nombre')
      .eq('email', profesorEmail.trim()).single();
    profesor = p2;
  }

  if (!profesor) {
    console.error('❌ Profesor no encontrado para email:', profesorEmail);
    return [];
  }

  console.log('✅ Profesor encontrado:', profesor.nombre, '| ID:', profesor.id);

  const { data: asignaciones, error: errAsig } = await supabase
    .from('profesor_asignaciones').select('grado, carrera').eq('profesor_id', profesor.id);

  if (errAsig) {
    console.error('❌ Error obteniendo asignaciones:', errAsig.message);
    return [];
  }

  console.log('📋 Asignaciones encontradas:', JSON.stringify(asignaciones));
  return asignaciones || [];
}

// ========== HELPER: IDs de materias del profesor ==========
async function obtenerIdsMateriaProfesor(profesorEmail) {
  if (!profesorEmail || profesorEmail === 'all' || profesorEmail === '') return null;

  let { data: profesor } = await supabase
    .from('profesores').select('id').eq('email', profesorEmail.trim()).single();

  if (!profesor) {
    const { data: p2 } = await supabase
      .from('profesores').select('id').eq('email', profesorEmail.trim().toLowerCase()).single();
    if (!p2) return [];
    const { data: m2 } = await supabase.from('materias').select('id').eq('profesor_id', p2.id);
    return m2 ? m2.map(m => m.id) : [];
  }

  const { data: materias } = await supabase.from('materias').select('id').eq('profesor_id', profesor.id);
  console.log('📚 Materias del profesor:', materias?.map(m => m.id));
  return materias ? materias.map(m => m.id) : [];
}

// ========== HELPER: estudiantes filtrados ==========
async function obtenerEstudiantesFiltrados(filtros) {
  const { data, error } = await supabase
    .from('estudiantes')
    .select('cedula, nombre, apellido, grado, seccion, carrera')
    .order('apellido', { ascending: true });
  if (error) throw error;
  if (filtros === null) return data;
  if (filtros.length === 0) return [];
  return data.filter(est => {
    const gradoEst   = normalizarTexto(String(est.grado));
    const carreraEst = normalizarTexto(est.carrera);
    return filtros.some(f =>
      normalizarTexto(String(f.grado)) === gradoEst &&
      normalizarTexto(f.carrera)       === carreraEst
    );
  });
}

// ========== ESTILOS ==========
const STYLE = {
  headerAzul: {
    font:      { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 },
    fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143C65' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border:    { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  },
  headerVerde: {
    font:      { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 },
    fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF256D5B' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border:    { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  },
  headerRojo: {
    font:      { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 },
    fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border:    { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  },
  dato: {
    font:      { name: 'Arial', size: 10 },
    alignment: { vertical: 'middle' },
    border:    {
      top:    { style: 'hair', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
      left:   { style: 'hair', color: { argb: 'FFE2E8F0' } },
      right:  { style: 'hair', color: { argb: 'FFE2E8F0' } },
    },
  },
  datoAlt: {
    font:      { name: 'Arial', size: 10 },
    fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } },
    alignment: { vertical: 'middle' },
    border:    {
      top:    { style: 'hair', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
      left:   { style: 'hair', color: { argb: 'FFE2E8F0' } },
      right:  { style: 'hair', color: { argb: 'FFE2E8F0' } },
    },
  },
};

function estiloDato(idx) { return idx % 2 === 0 ? STYLE.dato : STYLE.datoAlt; }

function barraVisual(valor, maximo, largo) {
  largo = largo || 18;
  if (!maximo || maximo === 0) return '';
  const llenos = Math.round((valor / maximo) * largo);
  return '\u2588'.repeat(llenos) + '\u2591'.repeat(largo - llenos);
}

// ========== REGISTRAR ASISTENCIA ==========
const registrarAsistencia = async (req, res) => {
  const { cedula, materiaId } = req.body;
  if (!cedula)    return res.status(400).json({ error: 'Cédula no proporcionada' });
  if (!materiaId) return res.status(400).json({ error: 'Debe especificar la materia/clase' });

  const { data: materia, error: errMateria } = await supabase
    .from('materias').select('grado, carrera').eq('id', materiaId).single();
  if (errMateria || !materia) return res.status(404).json({ error: 'La clase seleccionada no existe' });

  const { data: estudiante, error: errEst } = await supabase
    .from('estudiantes').select('cedula, nombre, apellido, grado, seccion, carrera, foto_url')
    .eq('cedula', cedula).single();
  if (errEst || !estudiante) return res.status(404).json({ error: 'Estudiante no encontrado' });

  if (
    normalizarTexto(String(estudiante.grado)) !== normalizarTexto(String(materia.grado)) ||
    normalizarTexto(estudiante.carrera)        !== normalizarTexto(materia.carrera)
  ) {
    return res.status(400).json({
      error: `Este estudiante no pertenece a esta clase. Solo se permite para grado ${materia.grado} - ${materia.carrera}.`,
    });
  }

  const hoy   = new Date().toISOString().split('T')[0];
  const ahora = new Date().toLocaleTimeString('en-GB', { hour12: false });

  const { data: yaRegistro } = await supabase.from('asistencia').select('id')
    .eq('cedula', cedula).eq('fecha', hoy).maybeSingle();
  if (yaRegistro)
    return res.status(400).json({ error: 'Este estudiante ya registró asistencia hoy', estudiante });

  const { error: errIns } = await supabase.from('asistencia')
    .insert([{ cedula, fecha: hoy, hora: ahora, materia_id: materiaId }]);
  if (errIns)
    return res.status(500).json({ error: 'Error al registrar asistencia: ' + errIns.message });

  res.json({
    message: 'Asistencia registrada exitosamente',
    estudiante: {
      cedula:    estudiante.cedula,
      nombre:    estudiante.nombre,
      apellido:  estudiante.apellido,
      grado:     estudiante.grado,
      seccion:   estudiante.seccion,
      carrera:   estudiante.carrera || 'No especificada',
      foto_url:  estudiante.foto_url || null,
    },
    hora: ahora,
  });
};

// ========== ASISTENCIA DEL DÍA ==========
const getAsistenciaHoy = async (req, res) => {
  const hoy       = new Date().toISOString().split('T')[0];
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
    id:             item.id,
    fecha:          item.fecha,
    hora:           item.hora,
    estudiante:     item.estudiantes,
    materia_nombre: item.materias?.nombre || 'Sin materia',
    faltasEnMes:    item.estudiantes?.cedula
      ? await contarFaltasEnMes(item.estudiantes.cedula, añoActual, mesActual) : 0,
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
  if (grado)   filtrados = filtrados.filter(a => a.estudiantes?.grado   === grado);
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
  else if (fechaInicio)        query = query.gte('fecha', fechaInicio);
  else if (fechaFin)           query = query.lte('fecha', fechaFin);

  if (profesorEmail && profesorEmail !== 'all' && profesorEmail !== '') {
    const ids = await obtenerIdsMateriaProfesor(profesorEmail);
    if (!ids || ids.length === 0) return res.json([]);
    query = query.in('materia_id', ids);
  }

  const { data, error } = await query.order('fecha', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data.map(item => ({ ...item, materia_nombre: item.materias?.nombre || 'Sin materia' })));
};

// ========== EXPORTAR EXCEL SIMPLE ==========
const exportarReporteExcel = async (req, res) => {
  const { fechaInicio, fechaFin, usuario } = req.query;
  if (!fechaInicio || !fechaFin)
    return res.status(400).json({ error: 'Debe proporcionar fechaInicio y fechaFin' });

  const { data, error } = await supabase.from('asistencia').select(`
    id, fecha, hora, estudiantes (cedula, nombre, apellido, grado, seccion)
  `).gte('fecha', fechaInicio).lte('fecha', fechaFin).order('fecha', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Reporte Asistencia');
  ws.columns = [
    { header: 'Fecha',    key: 'fecha',    width: 12 },
    { header: 'Hora',     key: 'hora',     width: 10 },
    { header: 'Cédula',   key: 'cedula',   width: 15 },
    { header: 'Nombre',   key: 'nombre',   width: 20 },
    { header: 'Apellido', key: 'apellido', width: 20 },
    { header: 'Grado',    key: 'grado',    width: 8  },
    { header: 'Sección',  key: 'seccion',  width: 8  },
  ];
  ws.getRow(1).eachCell(cell => { cell.style = STYLE.headerAzul; });

  data.forEach((item, idx) => {
    const r = ws.addRow({
      fecha:    item.fecha,
      hora:     item.hora,
      cedula:   item.estudiantes?.cedula   || '',
      nombre:   item.estudiantes?.nombre   || '',
      apellido: item.estudiantes?.apellido || '',
      grado:    item.estudiantes?.grado    || '',
      seccion:  item.estudiantes?.seccion  || '',
    });
    r.eachCell(cell => { cell.style = estiloDato(idx); });
  });

  const buffer   = await workbook.xlsx.writeBuffer();
  const fileName = `reporte_${fechaInicio}_a_${fechaFin}_${Date.now()}.xlsx`;
  const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    const wb  = new ExcelJS.Workbook();
    const wbs = wb.addWorksheet(`Asistencia_${fecha}`);
    wbs.addRow([mensaje]);
    const buf = await wb.xlsx.writeBuffer();
    const fn  = `reporte_vacio_${fecha}_${Date.now()}.xlsx`;
    await supabase.storage.from('reportes').upload(fn, buf, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
      const ids = await obtenerIdsMateriaProfesor(profesorEmail);
      if (!ids || ids.length === 0) {
        const url = await subirExcelVacio('No hay asistencias para este profesor en esta fecha.');
        return res.json({ success: true, url });
      }
      queryAsistencias = queryAsistencias.in('materia_id', ids);
    }
    if (grado)   queryAsistencias = queryAsistencias.filter('materias.grado',   'eq', grado);
    if (seccion) queryAsistencias = queryAsistencias.filter('materias.seccion', 'eq', seccion);

    const { data: asistencias, error: errA } = await queryAsistencias;
    if (errA) throw errA;

    const grupos = new Map();
    asistencias.forEach(asis => {
      const materia = asis.materias;
      if (!materia) return;
      if (!grupos.has(materia.id)) grupos.set(materia.id, { materia, asistencias: [] });
      grupos.get(materia.id).asistencias.push({ estudiante: asis.estudiantes, hora: asis.hora });
    });

    const workbook  = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Asistencia_${fecha}`);
    worksheet.views = [{ showGridLines: false }];

    const fechaLegible = new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'America/Tegucigalpa',
    });

    let currentRow = 1;

    worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
    const titleCell = worksheet.getCell(`A${currentRow}`);
    titleCell.value = `Fecha: ${fechaLegible}`;
    titleCell.font  = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
    titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143C65' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(currentRow).height = 28;
    currentRow++;

    if (nombreProfesor) {
      worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
      const profCell = worksheet.getCell(`A${currentRow}`);
      profCell.value = `Generado por: ${nombreProfesor}`;
      profCell.font  = { italic: true, name: 'Arial', size: 10, color: { argb: 'FF256D5B' } };
      profCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4F1' } };
      profCell.alignment = { horizontal: 'center' };
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
        worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
        const claseCell = worksheet.getCell(`A${currentRow}`);
        claseCell.value = `${mat.nombre || mat.carrera || 'Clase'} — Grado ${mat.grado}° Sección ${mat.seccion}`;
        claseCell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
        claseCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF256D5B' } };
        claseCell.alignment = { horizontal: 'left', indent: 1, vertical: 'middle' };
        worksheet.getRow(currentRow).height = 22;
        currentRow++;

        const encRow = worksheet.addRow([
          'Cédula', 'Nombre', 'Apellido', 'Grado (Est.)', 'Sección (Est.)', 'Carrera', 'Hora de Escaneo',
        ]);
        encRow.eachCell(cell => { cell.style = STYLE.headerAzul; });
        encRow.height = 20;
        currentRow++;

        grupo.asistencias.forEach((item, idx) => {
          const est = item.estudiante;
          const r   = worksheet.addRow([
            est?.cedula  || '', est?.nombre   || '', est?.apellido || '',
            est?.grado   || '', est?.seccion  || '', est?.carrera  || '', item.hora || '',
          ]);
          r.eachCell(cell => { cell.style = estiloDato(idx); });
          currentRow++;
        });

        worksheet.addRow([]); currentRow++;
      }
    }

    [15, 20, 20, 12, 12, 22, 16].forEach((w, i) => {
      if (worksheet.columns[i]) worksheet.columns[i].width = w;
    });

    const buffer   = await workbook.xlsx.writeBuffer();
    const fileName = `reporte_completo_${fecha}_${Date.now()}.xlsx`;
    const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

// ========== ESTADÍSTICAS JSON ==========
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
      fin    = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }
    console.log('📅 Rango:', inicio, '->', fin);

    const filtros     = await obtenerFiltrosProfesor(profesorEmail);
    const estudiantes = await obtenerEstudiantesFiltrados(filtros);
    console.log('👥 Estudiantes encontrados:', estudiantes.length);

    if (estudiantes.length === 0)
      return res.json({ masFaltas: [], mejorRecord: [], totalDias: 0, resumenGradoCarrera: [] });

    let asistencias = [];
    const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail);

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
      const count  = asistenciaCount[est.cedula] || 0;
      const faltas = totalDias - count;
      return { ...est, asistencias: count, faltas: faltas > 0 ? faltas : 0, totalDias };
    });

    const masFaltas   = [...estadisticasArr].sort((a, b) => b.faltas      - a.faltas).slice(0, 10);
    const mejorRecord = [...estadisticasArr].sort((a, b) => b.asistencias - a.asistencias).slice(0, 10);

    const resumenMap = {};
    estadisticasArr.forEach(est => {
      const key = `${est.grado}|${est.carrera || 'Sin carrera'}`;
      if (!resumenMap[key])
        resumenMap[key] = {
          grado: est.grado, carrera: est.carrera || 'Sin carrera',
          totalAsistencias: 0, totalEstudiantes: 0,
        };
      resumenMap[key].totalAsistencias += est.asistencias;
      resumenMap[key].totalEstudiantes++;
    });

    const resumenGradoCarrera = Object.values(resumenMap).map(item => ({
      ...item,
      promedioAsistencias: (item.totalAsistencias / item.totalEstudiantes).toFixed(1),
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
      fin    = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }

    const filtros     = await obtenerFiltrosProfesor(profesorEmail);
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
      const count  = asistenciaCount[est.cedula] || 0;
      const faltas = totalDias - count;
      return { ...est, asistencias: count, faltas: faltas > 0 ? faltas : 0, totalDias };
    });

    const masFaltas   = [...estadisticasArr].sort((a, b) => b.faltas      - a.faltas).slice(0, 10);
    const mejorRecord = [...estadisticasArr].sort((a, b) => b.asistencias - a.asistencias).slice(0, 10);

    const resumenMap = {};
    estadisticasArr.forEach(est => {
      const key = `${est.grado}|${est.carrera || 'Sin carrera'}`;
      if (!resumenMap[key])
        resumenMap[key] = {
          grado: est.grado, carrera: est.carrera || 'Sin carrera',
          totalAsistencias: 0, totalFaltas: 0, totalEstudiantes: 0,
        };
      resumenMap[key].totalAsistencias += est.asistencias;
      resumenMap[key].totalFaltas      += est.faltas;
      resumenMap[key].totalEstudiantes++;
    });
    const resumenArray = Object.values(resumenMap).map(item => ({
      ...item,
      promedioAsistencias: item.totalEstudiantes > 0
        ? (item.totalAsistencias / item.totalEstudiantes).toFixed(1) : '0',
    })).sort((a, b) => {
      if (String(a.grado) !== String(b.grado)) return String(a.grado).localeCompare(String(b.grado));
      return a.carrera.localeCompare(b.carrera);
    });

    const maxAsistencias = Math.max(...resumenArray.map(r => r.totalAsistencias), 1);
    const maxFaltasRes   = Math.max(...resumenArray.map(r => r.totalFaltas), 1);
    const maxFaltasTop   = Math.max(...masFaltas.map(e => e.faltas), 1);
    const maxRecordTop   = Math.max(...mejorRecord.map(e => e.asistencias), 1);
    const totalFaltasGlobal = estadisticasArr.reduce((s, e) => s + e.faltas, 0);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sistema de Asistencia';
    workbook.created = new Date();

    // ── HOJA 1: RESUMEN GENERAL ───────────────────────────────────────────────
    const wsDash = workbook.addWorksheet('Resumen General');
    wsDash.views = [{ showGridLines: false }];

    wsDash.mergeCells('A1:H1');
    const t1 = wsDash.getCell('A1');
    t1.value = `ESTADISTICAS DE ASISTENCIA - ${inicio} al ${fin}`;
    t1.font  = { bold: true, size: 16, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
    t1.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143C65' } };
    t1.alignment = { horizontal: 'center', vertical: 'middle' };
    wsDash.getRow(1).height = 38;

    wsDash.mergeCells('A2:H2');
    const t2 = wsDash.getCell('A2');
    t2.value = `Total estudiantes: ${estudiantes.length}   |   Total dias: ${totalDias}   |   Asistencias registradas: ${asistencias.length}`;
    t2.font  = { size: 11, color: { argb: 'FFFFFFFF' }, italic: true, name: 'Arial' };
    t2.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF256D5B' } };
    t2.alignment = { horizontal: 'center', vertical: 'middle' };
    wsDash.getRow(2).height = 24;

    wsDash.addRow([]);

    // Fila de KPIs
    const kpiTitulos = ['Total Estudiantes', 'Dias del Periodo', 'Total Asistencias', 'Total Faltas'];
    const kpiValores = [estudiantes.length, totalDias, asistencias.length, totalFaltasGlobal];
    const kpiColores = ['FF143C65', 'FF256D5B', 'FF1E6FA5', 'FFB91C1C'];
    const kpiCols    = ['A', 'C', 'E', 'G'];

    kpiCols.forEach((col, i) => {
      const nextCol = String.fromCharCode(col.charCodeAt(0) + 1);
      wsDash.mergeCells(`${col}4:${nextCol}4`);
      const lc = wsDash.getCell(`${col}4`);
      lc.value = kpiTitulos[i];
      lc.font  = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 };
      lc.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: kpiColores[i] } };
      lc.alignment = { horizontal: 'center', vertical: 'middle' };

      wsDash.mergeCells(`${col}5:${nextCol}5`);
      const vc = wsDash.getCell(`${col}5`);
      vc.value = kpiValores[i];
      vc.font  = { bold: true, size: 22, color: { argb: kpiColores[i] }, name: 'Arial' };
      vc.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      vc.alignment = { horizontal: 'center', vertical: 'middle' };
      vc.border = {
        top:    { style: 'medium', color: { argb: kpiColores[i] } },
        bottom: { style: 'medium', color: { argb: kpiColores[i] } },
        left:   { style: 'medium', color: { argb: kpiColores[i] } },
        right:  { style: 'medium', color: { argb: kpiColores[i] } },
      };
    });
    wsDash.getRow(4).height = 20;
    wsDash.getRow(5).height = 44;

    wsDash.addRow([]);

    // Tabla resumen por grado/carrera
    const encDash = wsDash.addRow([
      'Grado / Carrera', 'Asistencias', 'Barra Asistencias',
      'Faltas', 'Barra Faltas', 'Estudiantes', 'Promedio',
    ]);
    encDash.eachCell(cell => { cell.style = STYLE.headerAzul; });
    encDash.height = 22;

    const dashDataStart = 8;
    resumenArray.forEach((item, idx) => {
      const etiqueta  = `${item.grado} ${item.carrera}`;
      const barraAsis = barraVisual(item.totalAsistencias, maxAsistencias, 18);
      const barraFalt = barraVisual(item.totalFaltas, maxFaltasRes, 18);
      const r = wsDash.addRow([
        etiqueta, item.totalAsistencias, barraAsis,
        item.totalFaltas, barraFalt,
        item.totalEstudiantes, parseFloat(item.promedioAsistencias),
      ]);
      r.eachCell((cell, colNum) => {
        cell.style = estiloDato(idx);
        if (colNum === 3) cell.font = { name: 'Courier New', size: 9, color: { argb: 'FF143C65' } };
        if (colNum === 5) cell.font = { name: 'Courier New', size: 9, color: { argb: 'FFB91C1C' } };
      });
    });

    const dashDataEnd = dashDataStart + resumenArray.length - 1;
    if (resumenArray.length > 0) {
      wsDash.addConditionalFormatting({
        ref: `B${dashDataStart}:B${dashDataEnd}`,
        rules: [{
          type: 'colorScale',
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: [{ argb: 'FFFDE8E8' }, { argb: 'FF143C65' }],
        }],
      });
      wsDash.addConditionalFormatting({
        ref: `D${dashDataStart}:D${dashDataEnd}`,
        rules: [{
          type: 'colorScale',
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: [{ argb: 'FFFDE8E8' }, { argb: 'FFB91C1C' }],
        }],
      });
    }

    [28, 15, 22, 10, 22, 14, 12].forEach((w, i) => { wsDash.getColumn(i + 1).width = w; });

    // ── HOJA 2: TOP FALTAS ────────────────────────────────────────────────────
    const wsFaltas = workbook.addWorksheet('Top Faltas');
    wsFaltas.views = [{ showGridLines: false }];

    wsFaltas.mergeCells('A1:J1');
    const tf = wsFaltas.getCell('A1');
    tf.value = 'TOP 10 - ALUMNOS CON MAS FALTAS';
    tf.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
    tf.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } };
    tf.alignment = { horizontal: 'center', vertical: 'middle' };
    wsFaltas.getRow(1).height = 30;

    wsFaltas.addRow([]);

    const encFaltas = wsFaltas.addRow([
      '#', 'Cedula', 'Nombre', 'Apellido', 'Grado', 'Seccion', 'Carrera', 'Asistencias', 'Faltas', 'Barra',
    ]);
    encFaltas.eachCell(cell => { cell.style = STYLE.headerRojo; });
    encFaltas.height = 22;

    masFaltas.forEach((est, idx) => {
      const barra = barraVisual(est.faltas, maxFaltasTop, 15);
      const r = wsFaltas.addRow([
        idx + 1, est.cedula, est.nombre, est.apellido,
        est.grado, est.seccion, est.carrera, est.asistencias, est.faltas, barra,
      ]);
      r.eachCell((cell, colNum) => {
        cell.style = estiloDato(idx);
        if (colNum === 9 && est.faltas >= 3)
          cell.font = { bold: true, color: { argb: 'FFCC0000' }, name: 'Arial', size: 10 };
        if (colNum === 10)
          cell.font = { name: 'Courier New', size: 9, color: { argb: 'FFB91C1C' } };
      });
    });

    if (masFaltas.length > 0) {
      wsFaltas.addConditionalFormatting({
        ref: `I3:I${3 + masFaltas.length - 1}`,
        rules: [{
          type: 'colorScale',
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: [{ argb: 'FFFFFFCC' }, { argb: 'FFB91C1C' }],
        }],
      });
    }

    [5, 16, 20, 20, 8, 10, 22, 13, 10, 20].forEach((w, i) => { wsFaltas.getColumn(i + 1).width = w; });

    // ── HOJA 3: MEJOR RÉCORD ──────────────────────────────────────────────────
    const wsRecord = workbook.addWorksheet('Mejor Record');
    wsRecord.views = [{ showGridLines: false }];

    wsRecord.mergeCells('A1:J1');
    const tr = wsRecord.getCell('A1');
    tr.value = 'TOP 10 - ALUMNOS CON MEJOR RECORD DE ASISTENCIA';
    tr.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
    tr.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF256D5B' } };
    tr.alignment = { horizontal: 'center', vertical: 'middle' };
    wsRecord.getRow(1).height = 30;

    wsRecord.addRow([]);

    const encRecord = wsRecord.addRow([
      '#', 'Cedula', 'Nombre', 'Apellido', 'Grado', 'Seccion', 'Carrera', 'Asistencias', 'Faltas', 'Barra',
    ]);
    encRecord.eachCell(cell => { cell.style = STYLE.headerVerde; });
    encRecord.height = 22;

    mejorRecord.forEach((est, idx) => {
      const barra = barraVisual(est.asistencias, maxRecordTop, 15);
      const r = wsRecord.addRow([
        idx + 1, est.cedula, est.nombre, est.apellido,
        est.grado, est.seccion, est.carrera, est.asistencias, est.faltas, barra,
      ]);
      r.eachCell((cell, colNum) => {
        cell.style = estiloDato(idx);
        if (colNum === 8)
          cell.font = { bold: true, color: { argb: 'FF256D5B' }, name: 'Arial', size: 10 };
        if (colNum === 10)
          cell.font = { name: 'Courier New', size: 9, color: { argb: 'FF256D5B' } };
      });
    });

    if (mejorRecord.length > 0) {
      wsRecord.addConditionalFormatting({
        ref: `H3:H${3 + mejorRecord.length - 1}`,
        rules: [{
          type: 'colorScale',
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: [{ argb: 'FFE6F4F1' }, { argb: 'FF256D5B' }],
        }],
      });
    }

    [5, 16, 20, 20, 8, 10, 22, 13, 10, 20].forEach((w, i) => { wsRecord.getColumn(i + 1).width = w; });

    // ── HOJA 4: DETALLE COMPLETO ──────────────────────────────────────────────
    const wsDetalle = workbook.addWorksheet('Detalle Completo');
    wsDetalle.views = [{ showGridLines: false }];

    wsDetalle.mergeCells('A1:I1');
    const td = wsDetalle.getCell('A1');
    td.value = `DETALLE COMPLETO - ${inicio} al ${fin}`;
    td.font  = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
    td.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143C65' } };
    td.alignment = { horizontal: 'center', vertical: 'middle' };
    wsDetalle.getRow(1).height = 28;

    wsDetalle.addRow([]);

    const encDetalle = wsDetalle.addRow([
      'Cedula', 'Nombre', 'Apellido', 'Grado', 'Seccion', 'Carrera', 'Asistencias', 'Faltas', 'Total Dias',
    ]);
    encDetalle.eachCell(cell => { cell.style = STYLE.headerAzul; });
    encDetalle.height = 22;

    estadisticasArr.forEach((est, idx) => {
      const r = wsDetalle.addRow([
        est.cedula, est.nombre, est.apellido, est.grado,
        est.seccion, est.carrera, est.asistencias, est.faltas, est.totalDias,
      ]);
      r.eachCell((cell, colNum) => {
        cell.style = estiloDato(idx);
        if (colNum === 7)
          cell.font = { bold: true, color: { argb: 'FF256D5B' }, name: 'Arial', size: 10 };
        if (colNum === 8 && est.faltas >= 3)
          cell.font = { bold: true, color: { argb: 'FFCC0000' }, name: 'Arial', size: 10 };
      });
    });

    if (estadisticasArr.length > 0) {
      const detalleEnd = 3 + estadisticasArr.length - 1;
      wsDetalle.addConditionalFormatting({
        ref: `G3:G${detalleEnd}`,
        rules: [{
          type: 'colorScale',
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: [{ argb: 'FFFDE8E8' }, { argb: 'FF256D5B' }],
        }],
      });
      wsDetalle.addConditionalFormatting({
        ref: `H3:H${detalleEnd}`,
        rules: [{
          type: 'colorScale',
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: [{ argb: 'FFFDE8E8' }, { argb: 'FFB91C1C' }],
        }],
      });
    }

    [16, 20, 20, 8, 10, 22, 13, 10, 12].forEach((w, i) => { wsDetalle.getColumn(i + 1).width = w; });

    // ── SUBIR ─────────────────────────────────────────────────────────────────
    const buffer   = await workbook.xlsx.writeBuffer();
    const fileName = `estadisticas_${inicio}_a_${fin}_${Date.now()}.xlsx`;

    const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
    console.log('✅ Excel estadisticas generado:', fileName);
    res.json({ success: true, url: urlData.publicUrl });

  } catch (error) {
    console.error('❌ Error exportando estadisticas:', error);
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
