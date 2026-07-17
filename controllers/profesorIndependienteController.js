const { supabase, supabaseAdmin } = require('../config/supabase');
const { parseExcel } = require('../utils/excelParser');
const ExcelJS = require('exceljs');

// ════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════

const registrarProfesorIndependiente = async (req, res) => {
  const { email, nombre, password } = req.body;
  if (!email || !nombre || !password) {
    return res.status(400).json({ error: 'Email, nombre y contraseña son obligatorios' });
  }

  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authError) return res.status(400).json({ error: authError.message });

    const { data, error } = await supabase
      .from('profesores_independientes')
      .insert([{ id: authData.user.id, nombre, email, activo: true }])
      .select()
      .single();

    if (error) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(400).json({ error: error.message });
    }

    console.log(`✅ Profesor independiente registrado: ${email}`);
    res.json({ success: true, profesor: data });
  } catch (err) {
    console.error('❌ Error en registrarProfesorIndependiente:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ════════════════════════════════════════════════════════════════
// CLASES
// ════════════════════════════════════════════════════════════════

const getMisClases = async (req, res) => {
  try {
    const profesorId = req.user.id;
    const { data, error } = await supabase
      .from('clases_independientes')
      .select('*')
      .eq('profesor_id', profesorId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getMisClases:', err.message);
    res.status(500).json({ error: 'Error al cargar clases' });
  }
};

const crearClase = async (req, res) => {
  const { nombre, descripcion } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre de la clase es obligatorio' });

  try {
    const profesorId = req.user.id;
    const { data, error } = await supabase
      .from('clases_independientes')
      .insert([{ profesor_id: profesorId, nombre, descripcion: descripcion || null }])
      .select()
      .single();
    if (error) throw error;
    console.log(`✅ Clase independiente creada: ${nombre}`);
    res.json(data);
  } catch (err) {
    console.error('❌ Error en crearClase:', err.message);
    res.status(500).json({ error: 'Error al crear la clase' });
  }
};

const eliminarClase = async (req, res) => {
  const { id } = req.params;
  try {
    const profesorId = req.user.id;
    const { error } = await supabase
      .from('clases_independientes')
      .delete()
      .eq('id', id)
      .eq('profesor_id', profesorId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error en eliminarClase:', err.message);
    res.status(500).json({ error: 'Error al eliminar la clase' });
  }
};

// ════════════════════════════════════════════════════════════════
// MATERIAS (dentro de una clase)
// ════════════════════════════════════════════════════════════════

const getMateriasDeClase = async (req, res) => {
  const { claseId } = req.params;
  try {
    const profesorId = req.user.id;
    const { data: clase } = await supabase
      .from('clases_independientes')
      .select('id')
      .eq('id', claseId)
      .eq('profesor_id', profesorId)
      .maybeSingle();
    if (!clase) return res.status(403).json({ error: 'No tienes acceso a esta clase' });

    const { data, error } = await supabase
      .from('materias_independientes')
      .select('*')
      .eq('clase_id', claseId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getMateriasDeClase:', err.message);
    res.status(500).json({ error: 'Error al cargar materias' });
  }
};

const crearMateria = async (req, res) => {
  const { clase_id, nombre, descripcion } = req.body;
  if (!clase_id || !nombre) return res.status(400).json({ error: 'Clase y nombre de materia son obligatorios' });

  try {
    const profesorId = req.user.id;
    const { data: clase } = await supabase
      .from('clases_independientes')
      .select('id')
      .eq('id', clase_id)
      .eq('profesor_id', profesorId)
      .maybeSingle();
    if (!clase) return res.status(403).json({ error: 'No tienes acceso a esta clase' });

    const { data, error } = await supabase
      .from('materias_independientes')
      .insert([{ clase_id, nombre, descripcion: descripcion || null }])
      .select()
      .single();
    if (error) throw error;
    console.log(`✅ Materia creada: ${nombre}`);
    res.json(data);
  } catch (err) {
    console.error('❌ Error en crearMateria:', err.message);
    res.status(500).json({ error: 'Error al crear la materia' });
  }
};

const eliminarMateria = async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('materias_independientes')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error en eliminarMateria:', err.message);
    res.status(500).json({ error: 'Error al eliminar la materia' });
  }
};

// ════════════════════════════════════════════════════════════════
// ESTUDIANTES
// ════════════════════════════════════════════════════════════════

const getEstudiantesDeClase = async (req, res) => {
  const { claseId } = req.params;
  try {
    const profesorId = req.user.id;
    const { data: clase } = await supabase
      .from('clases_independientes')
      .select('id')
      .eq('id', claseId)
      .eq('profesor_id', profesorId)
      .maybeSingle();
    if (!clase) return res.status(403).json({ error: 'No tienes acceso a esta clase' });

    const { data, error } = await supabase
      .from('estudiantes_independientes')
      .select('*')
      .eq('clase_id', claseId)
      .order('apellido', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getEstudiantesDeClase:', err.message);
    res.status(500).json({ error: 'Error al cargar estudiantes' });
  }
};

const crearEstudiante = async (req, res) => {
  const { cedula, nombre, apellido, clase_id, foto_url } = req.body;
  if (!cedula || !nombre || !apellido || !clase_id) {
    return res.status(400).json({ error: 'Cédula, nombre, apellido y clase son obligatorios' });
  }

  try {
    const profesorId = req.user.id;
    const { data: clase } = await supabase
      .from('clases_independientes')
      .select('id')
      .eq('id', clase_id)
      .eq('profesor_id', profesorId)
      .maybeSingle();
    if (!clase) return res.status(403).json({ error: 'No tienes acceso a esta clase' });

    const { data, error } = await supabase
      .from('estudiantes_independientes')
      .insert([{ cedula, nombre, apellido, clase_id, foto_url: foto_url || null }])
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('❌ Error en crearEstudiante (independiente):', err.message);
    res.status(500).json({ error: err.message || 'Error al crear estudiante' });
  }
};

// ✅ NUEVO: Carga masiva de estudiantes desde Excel
const bulkUploadEstudiantes = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }
    const { clase_id } = req.body;
    if (!clase_id) return res.status(400).json({ error: 'Debe especificar la clase' });

    const profesorId = req.user.id;
    const { data: clase } = await supabase
      .from('clases_independientes')
      .select('id')
      .eq('id', clase_id)
      .eq('profesor_id', profesorId)
      .maybeSingle();
    if (!clase) return res.status(403).json({ error: 'No tienes acceso a esta clase' });

    // Reutiliza el mismo parser del modo institución
    // (ignora grado/seccion/carrera que vengan en el Excel, solo usa cedula/nombre/apellido)
    const estudiantesExcel = await parseExcel(req.file.buffer);
    const resultados = { exitosos: [], fallidos: [] };

    for (const est of estudiantesExcel) {
      const { error } = await supabase
        .from('estudiantes_independientes')
        .insert([{
          cedula: est.cedula,
          nombre: est.nombre,
          apellido: est.apellido || '',
          clase_id,
        }]);

      if (error) {
        resultados.fallidos.push({ ...est, error: error.message });
      } else {
        resultados.exitosos.push(est);
      }
    }

    console.log(`✅ Carga masiva independiente: ${resultados.exitosos.length} ok, ${resultados.fallidos.length} fallidos`);
    res.json({
      message: `Carga completada: ${resultados.exitosos.length} exitosos, ${resultados.fallidos.length} fallidos`,
      resultados,
    });
  } catch (err) {
    console.error('❌ Error en bulkUploadEstudiantes (independiente):', err.message);
    res.status(500).json({ error: err.message });
  }
};

const eliminarEstudiante = async (req, res) => {
  const { cedula } = req.params;
  try {
    const { error } = await supabase
      .from('estudiantes_independientes')
      .delete()
      .eq('cedula', cedula);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error en eliminarEstudiante (independiente):', err.message);
    res.status(500).json({ error: 'Error al eliminar estudiante' });
  }
};

// ════════════════════════════════════════════════════════════════
// ASISTENCIA
// ════════════════════════════════════════════════════════════════

const registrarAsistencia = async (req, res) => {
  const { cedula, clase_id, materia_id } = req.body;
  if (!cedula || !clase_id || !materia_id) {
    return res.status(400).json({ error: 'Cédula, clase y materia son obligatorios' });
  }

  try {
    const hoy = new Date().toISOString().split('T')[0];
    const ahora = new Date().toLocaleTimeString('en-GB', { hour12: false });

    const { data: estudiante, error: errEst } = await supabase
      .from('estudiantes_independientes')
      .select('cedula, nombre, apellido')
      .eq('cedula', cedula)
      .eq('clase_id', clase_id)
      .maybeSingle();
    if (errEst || !estudiante) return res.status(404).json({ error: 'Estudiante no encontrado en esta clase' });

    const { data: yaRegistro } = await supabase
      .from('asistencia_independiente')
      .select('id')
      .eq('cedula', cedula).eq('materia_id', materia_id).eq('fecha', hoy)
      .maybeSingle();
    if (yaRegistro) return res.status(400).json({ error: 'Este estudiante ya registró asistencia en esta materia hoy', estudiante });

    const { error } = await supabase
      .from('asistencia_independiente')
      .insert([{ cedula, clase_id, materia_id, fecha: hoy, hora: ahora }]);
    if (error) throw error;

    res.json({ message: 'Asistencia registrada', estudiante, hora: ahora });
  } catch (err) {
    console.error('❌ Error en registrarAsistencia (independiente):', err.message);
    res.status(500).json({ error: 'Error al registrar asistencia' });
  }
};

const getAsistenciaHoy = async (req, res) => {
  const { materiaId } = req.params;
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('asistencia_independiente')
      .select(`
        id, fecha, hora,
        estudiantes_independientes (cedula, nombre, apellido, foto_url)
      `)
      .eq('materia_id', materiaId)
      .eq('fecha', hoy);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getAsistenciaHoy (independiente):', err.message);
    res.status(500).json({ error: 'Error al cargar asistencia' });
  }
};

const limpiarAsistenciaHoy = async (req, res) => {
  const { materiaId } = req.params;
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const { error } = await supabase
      .from('asistencia_independiente')
      .delete()
      .eq('materia_id', materiaId)
      .eq('fecha', hoy);
    if (error) throw error;
    res.json({ message: 'Asistencia del día limpiada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al limpiar asistencia' });
  }
};

// ════════════════════════════════════════════════════════════════
// REPORTES (JSON, vista rápida en pantalla)
// ════════════════════════════════════════════════════════════════

const getReporte = async (req, res) => {
  const { materiaId } = req.params;
  const { fechaInicio, fechaFin } = req.query;
  try {
    let query = supabase
      .from('asistencia_independiente')
      .select(`
        id, fecha, hora,
        estudiantes_independientes (cedula, nombre, apellido)
      `)
      .eq('materia_id', materiaId);

    if (fechaInicio) query = query.gte('fecha', fechaInicio);
    if (fechaFin) query = query.lte('fecha', fechaFin);

    const { data, error } = await query.order('fecha', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getReporte (independiente):', err.message);
    res.status(500).json({ error: 'Error al cargar reporte' });
  }
};

const getReporteClaseCompleto = async (req, res) => {
  const { claseId } = req.params;
  const { fechaInicio, fechaFin } = req.query;
  try {
    let query = supabase
      .from('asistencia_independiente')
      .select(`
        id, fecha, hora, materia_id,
        estudiantes_independientes (cedula, nombre, apellido),
        materias_independientes (nombre)
      `)
      .eq('clase_id', claseId);

    if (fechaInicio) query = query.gte('fecha', fechaInicio);
    if (fechaFin) query = query.lte('fecha', fechaFin);

    const { data, error } = await query.order('fecha', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getReporteClaseCompleto:', err.message);
    res.status(500).json({ error: 'Error al cargar reporte' });
  }
};

// ════════════════════════════════════════════════════════════════
// ✅ NUEVO: EXPORTAR REPORTE A EXCEL (detallado, con colores)
// ════════════════════════════════════════════════════════════════

const COLOR_HEADER = 'FF3D5AFE';   // azul del modo independiente
const COLOR_ACCENT = 'FF00BFA5';   // verde/teal acento

const exportarReporteExcel = async (req, res) => {
  const { claseId } = req.params;
  const { fechaInicio, fechaFin } = req.query;

  try {
    const profesorId = req.user.id;

    // Verificar acceso y obtener nombre de la clase
    const { data: clase } = await supabase
      .from('clases_independientes')
      .select('id, nombre')
      .eq('id', claseId)
      .eq('profesor_id', profesorId)
      .maybeSingle();
    if (!clase) return res.status(403).json({ error: 'No tienes acceso a esta clase' });

    const inicio = fechaInicio || new Date(new Date().setDate(1)).toISOString().split('T')[0];
    const fin = fechaFin || new Date().toISOString().split('T')[0];

    // Estudiantes de la clase
    const { data: estudiantes } = await supabase
      .from('estudiantes_independientes')
      .select('cedula, nombre, apellido')
      .eq('clase_id', claseId)
      .order('apellido', { ascending: true });

    // Materias de la clase
    const { data: materias } = await supabase
      .from('materias_independientes')
      .select('id, nombre')
      .eq('clase_id', claseId);

    // Asistencias en el rango
    const { data: asistencias } = await supabase
      .from('asistencia_independiente')
      .select(`
        cedula, fecha, hora, materia_id,
        estudiantes_independientes (cedula, nombre, apellido),
        materias_independientes (nombre)
      `)
      .eq('clase_id', claseId)
      .gte('fecha', inicio)
      .lte('fecha', fin)
      .order('fecha', { ascending: false });

    const workbook = new ExcelJS.Workbook();

    const headerStyle = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
    };
    const dataStyle = {
      border: { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } },
    };
    const altRowStyle = { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } }, border: dataStyle.border };

    // ── Hoja 1: Dashboard ──────────────────────────────────────────────────
    const wsDash = workbook.addWorksheet('Dashboard');
    wsDash.mergeCells('A1:E1');
    wsDash.getCell('A1').value = `CLASE: ${clase.nombre.toUpperCase()}`;
    wsDash.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    wsDash.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER } };
    wsDash.getCell('A1').alignment = { horizontal: 'center' };

    wsDash.mergeCells('A2:E2');
    wsDash.getCell('A2').value = `Reporte de Asistencia: ${inicio} al ${fin}`;
    wsDash.getCell('A2').font = { size: 12, color: { argb: 'FFFFFFFF' }, italic: true };
    wsDash.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ACCENT } };

    wsDash.addRow([]);
    wsDash.getRow(4).values = ['Materia', 'Total Registros'];
    wsDash.getRow(4).eachCell(cell => { cell.style = headerStyle; });

    materias?.forEach((mat, idx) => {
      const totalMateria = (asistencias || []).filter(a => a.materia_id === mat.id).length;
      const r = wsDash.addRow([mat.nombre, totalMateria]);
      r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; });
      r.getCell(2).font = { bold: true, color: { argb: 'FF00897B' } };
    });

    wsDash.columns = [{ width: 30 }, { width: 18 }];

    // ── Hoja por cada materia ─────────────────────────────────────────────
    for (const materia of (materias || [])) {
      const asistenciasMateria = (asistencias || []).filter(a => a.materia_id === materia.id);
      const wsMat = workbook.addWorksheet(materia.nombre.substring(0, 28)); // límite de Excel para nombres de hoja

      wsMat.mergeCells('A1:E1');
      wsMat.getCell('A1').value = `${clase.nombre} — ${materia.nombre}`;
      wsMat.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      wsMat.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER } };
      wsMat.getCell('A1').alignment = { horizontal: 'center' };
      wsMat.addRow([]);

      wsMat.getRow(3).values = ['Fecha', 'Hora', 'Cédula', 'Nombre', 'Apellido'];
      wsMat.getRow(3).eachCell(cell => { cell.style = headerStyle; });

      asistenciasMateria.forEach((item, idx) => {
        const est = item.estudiantes_independientes;
        const r = wsMat.addRow([item.fecha, item.hora, est?.cedula || '', est?.nombre || '', est?.apellido || '']);
        r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; });
      });

      wsMat.columns = [{ width: 14 }, { width: 12 }, { width: 16 }, { width: 20 }, { width: 20 }];
    }

    // ── Hoja: Lista completa de estudiantes ───────────────────────────────
    const wsEst = workbook.addWorksheet('Estudiantes');
    wsEst.mergeCells('A1:C1');
    wsEst.getCell('A1').value = `ESTUDIANTES — ${clase.nombre.toUpperCase()}`;
    wsEst.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    wsEst.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER } };
    wsEst.addRow([]);
    wsEst.getRow(3).values = ['Cédula', 'Nombre', 'Apellido'];
    wsEst.getRow(3).eachCell(cell => { cell.style = headerStyle; });
    (estudiantes || []).forEach((est, idx) => {
      const r = wsEst.addRow([est.cedula, est.nombre, est.apellido]);
      r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; });
    });
    wsEst.columns = [{ width: 16 }, { width: 22 }, { width: 22 }];

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `reporte_${clase.nombre.replace(/\s+/g, '_')}_${inicio}_a_${fin}_${Date.now()}.xlsx`;

    const { error: uploadError } = await supabase.storage
      .from('reportes')
      .upload(fileName, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
    console.log(`✅ Reporte Excel generado: ${fileName}`);
    res.json({ success: true, url: urlData.publicUrl });
  } catch (err) {
    console.error('❌ Error en exportarReporteExcel (independiente):', err.message);
    res.status(500).json({ error: err.message || 'Error al generar el reporte' });
  }
};

module.exports = {
  registrarProfesorIndependiente,
  getMisClases,
  crearClase,
  eliminarClase,
  getMateriasDeClase,
  crearMateria,
  eliminarMateria,
  getEstudiantesDeClase,
  crearEstudiante,
  bulkUploadEstudiantes,
  eliminarEstudiante,
  registrarAsistencia,
  getAsistenciaHoy,
  limpiarAsistenciaHoy,
  getReporte,
  getReporteClaseCompleto,
  exportarReporteExcel,
};
