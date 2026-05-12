const { supabase } = require('../config/supabase');

// Obtener hijos del padre
const getHijos = async (req, res) => {
  try {
    const padreId = req.user.id;
    const institucion_id = req.user.institucion_id;
    
    // Buscar relación padre-estudiante
    let query = supabase
      .from('padre_estudiante')
      .select(`
        estudiante_id,
        estudiantes:estudiante_id (
          cedula, nombre, apellido, grado, seccion, carrera, foto_url
        )
      `)
      .eq('padre_id', padreId);
    
    if (institucion_id) query = query.eq('institucion_id', institucion_id);
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    const hijos = data.map(item => ({
      id: item.estudiante_id,
      ...item.estudiantes
    }));
    
    res.json(hijos);
  } catch (error) {
    console.error('Error en getHijos:', error);
    res.status(500).json({ error: error.message });
  }
};

// Ver asistencia de un estudiante específico
const getAsistenciaEstudiante = async (req, res) => {
  try {
    const { estudianteId } = req.params;
    const { fechaInicio, fechaFin, mes, año } = req.query;
    const institucion_id = req.user.institucion_id;
    
    let inicio, fin;
    if (fechaInicio && fechaFin) {
      inicio = fechaInicio;
      fin = fechaFin;
    } else if (mes && año) {
      inicio = `${año}-${mes.toString().padStart(2, '0')}-01`;
      fin = new Date(año, mes, 0).toISOString().split('T')[0];
    } else {
      // Últimos 30 días por defecto
      fin = new Date().toISOString().split('T')[0];
      inicio = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }
    
    let query = supabase
      .from('asistencia')
      .select(`
        id, fecha, hora,
        materias (nombre, grado, seccion, carrera)
      `)
      .eq('cedula', estudianteId)
      .gte('fecha', inicio)
      .lte('fecha', fin)
      .order('fecha', { ascending: false });
    
    if (institucion_id) query = query.eq('institucion_id', institucion_id);
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    // Calcular estadísticas
    const totalDias = Math.ceil((new Date(fin) - new Date(inicio)) / (1000 * 60 * 60 * 24)) + 1;
    const asistencias = data.length;
    const faltas = totalDias - asistencias;
    const porcentaje = totalDias > 0 ? ((asistencias / totalDias) * 100).toFixed(1) : 0;
    
    // Agrupar por mes
    const porMes = {};
    data.forEach(asis => {
      const mesKey = asis.fecha.substring(0, 7);
      if (!porMes[mesKey]) porMes[mesKey] = 0;
      porMes[mesKey]++;
    });
    
    res.json({
      estudiante_id: estudianteId,
      periodo: { inicio, fin },
      resumen: { totalDias, asistencias, faltas, porcentaje },
      asistencias: data,
      por_mes: porMes
    });
  } catch (error) {
    console.error('Error en getAsistenciaEstudiante:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener estadísticas completas
const getEstadisticasEstudiante = async (req, res) => {
  try {
    const { estudianteId } = req.params;
    const { año } = req.query;
    const institucion_id = req.user.institucion_id;
    const añoActual = año || new Date().getFullYear();
    
    // Asistencias por mes
    const meses = [];
    for (let mes = 1; mes <= 12; mes++) {
      const inicio = `${añoActual}-${mes.toString().padStart(2, '0')}-01`;
      const fin = new Date(añoActual, mes, 0).toISOString().split('T')[0];
      
      let query = supabase
        .from('asistencia')
        .select('id', { count: 'exact', head: true })
        .eq('cedula', estudianteId)
        .gte('fecha', inicio)
        .lte('fecha', fin);
      
      if (institucion_id) query = query.eq('institucion_id', institucion_id);
      
      const { count, error } = await query;
      if (!error) {
        const diasEnMes = new Date(añoActual, mes, 0).getDate();
        meses.push({
          mes,
          nombre: new Date(añoActual, mes - 1).toLocaleString('es', { month: 'long' }),
          asistencias: count || 0,
          total_dias: diasEnMes,
          porcentaje: (( (count || 0) / diasEnMes) * 100).toFixed(1)
        });
      }
    }
    
    // Materias con más asistencias
    let materiasQuery = supabase
      .from('asistencia')
      .select('materias (nombre, id)')
      .eq('cedula', estudianteId)
      .gte('fecha', `${añoActual}-01-01`)
      .lte('fecha', `${añoActual}-12-31`);
    
    if (institucion_id) materiasQuery = materiasQuery.eq('institucion_id', institucion_id);
    
    const { data: asistenciasMaterias } = await materiasQuery;
    
    const materiasCount = {};
    asistenciasMaterias?.forEach(asis => {
      const nombre = asis.materias?.nombre || 'Sin materia';
      materiasCount[nombre] = (materiasCount[nombre] || 0) + 1;
    });
    
    const materiasTop = Object.entries(materiasCount)
      .map(([nombre, count]) => ({ nombre, asistencias: count }))
      .sort((a, b) => b.asistencias - a.asistencias)
      .slice(0, 5);
    
    res.json({
      año: añoActual,
      por_mes: meses,
      materias_destacadas: materiasTop,
      total_asistencias_año: asistenciasMaterias?.length || 0
    });
  } catch (error) {
    console.error('Error en getEstadisticasEstudiante:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener horarios del estudiante
const getHorariosEstudiante = async (req, res) => {
  try {
    const { estudianteId } = req.params;
    const institucion_id = req.user.institucion_id;
    
    // Obtener grado y carrera del estudiante
    const { data: estudiante, error: errEst } = await supabase
      .from('estudiantes')
      .select('grado, carrera, seccion')
      .eq('cedula', estudianteId)
      .single();
    
    if (errEst || !estudiante) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }
    
    // Buscar horarios por grado y carrera
    let query = supabase
      .from('horarios')
      .select('*')
      .eq('grado', estudiante.grado)
      .eq('carrera', estudiante.carrera);
    
    if (estudiante.seccion) query = query.eq('seccion', estudiante.seccion);
    if (institucion_id) query = query.eq('institucion_id', institucion_id);
    
    const { data: horarios, error } = await query.order('dia_semana', { ascending: true });
    
    if (error) throw error;
    
    // Si no hay horarios específicos, devolver estructura vacía
    const diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const horariosPorDia = diasSemana.map(dia => ({
      dia,
      materias: horarios?.filter(h => h.dia_semana === dia) || []
    }));
    
    res.json({
      grado: estudiante.grado,
      carrera: estudiante.carrera,
      seccion: estudiante.seccion,
      horarios: horariosPorDia
    });
  } catch (error) {
    console.error('Error en getHorariosEstudiante:', error);
    // Devolver estructura vacía en lugar de error
    res.json({
      grado: null,
      carrera: null,
      seccion: null,
      horarios: [],
      mensaje: 'No hay horarios configurados para este estudiante'
    });
  }
};

// Obtener alertas del estudiante
const getAlertasEstudiante = async (req, res) => {
  try {
    const { estudianteId } = req.params;
    const institucion_id = req.user.institucion_id;
    
    // Obtener alertas (faltas reiteradas, bajo rendimiento)
    const alertas = [];
    
    // Verificar faltas en los últimos 30 días
    const hoy = new Date();
    const hace30Dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const inicio = hace30Dias.toISOString().split('T')[0];
    const fin = hoy.toISOString().split('T')[0];
    
    let queryAsistencias = supabase
      .from('asistencia')
      .select('id, fecha', { count: 'exact' })
      .eq('cedula', estudianteId)
      .gte('fecha', inicio)
      .lte('fecha', fin);
    
    if (institucion_id) queryAsistencias = queryAsistencias.eq('institucion_id', institucion_id);
    
    const { count: asistencias30, error: errAsis } = await queryAsistencias;
    
    if (!errAsis) {
      const diasTotales = 30;
      const faltas30 = diasTotales - (asistencias30 || 0);
      
      if (faltas30 >= 5) {
        alertas.push({
          tipo: 'warning',
          titulo: '⚠️ Alto índice de faltas',
          mensaje: `Tiene ${faltas30} faltas en los últimos 30 días.`,
          fecha: new Date().toISOString(),
          leida: false
        });
      } else if (faltas30 >= 3) {
        alertas.push({
          tipo: 'info',
          titulo: '📊 Faltas recientes',
          mensaje: `Tiene ${faltas30} faltas en los últimos 30 días.`,
          fecha: new Date().toISOString(),
          leida: false
        });
      }
    }
    
    // Buscar alertas guardadas en BD
    let queryAlertas = supabase
      .from('alertas_padres')
      .select('*')
      .eq('estudiante_id', estudianteId)
      .order('fecha_creacion', { ascending: false });
    
    if (institucion_id) queryAlertas = queryAlertas.eq('institucion_id', institucion_id);
    
    const { data: alertasGuardadas } = await queryAlertas;
    
    if (alertasGuardadas) {
      alertas.push(...alertasGuardadas);
    }
    
    res.json(alertas);
  } catch (error) {
    console.error('Error en getAlertasEstudiante:', error);
    res.json([]);
  }
};

// Marcar alerta como leída
const marcarAlertaLeida = async (req, res) => {
  try {
    const { alertaId } = req.params;
    
    const { error } = await supabase
      .from('alertas_padres')
      .update({ leida: true, fecha_leida: new Date().toISOString() })
      .eq('id', alertaId);
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error en marcarAlertaLeida:', error);
    res.status(500).json({ error: error.message });
  }
};

// Generar reporte PDF/Excel del estudiante
const generarReporteEstudiante = async (req, res) => {
  try {
    const { estudianteId } = req.params;
    const { fechaInicio, fechaFin } = req.query;
    const institucion_id = req.user.institucion_id;
    
    const inicio = fechaInicio || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const fin = fechaFin || new Date().toISOString().split('T')[0];
    
    // Obtener datos del estudiante
    const { data: estudiante, error: errEst } = await supabase
      .from('estudiantes')
      .select('*')
      .eq('cedula', estudianteId)
      .single();
    
    if (errEst) throw errEst;
    
    // Obtener asistencias del período
    let query = supabase
      .from('asistencia')
      .select(`
        fecha, hora,
        materias (nombre, grado, seccion, carrera)
      `)
      .eq('cedula', estudianteId)
      .gte('fecha', inicio)
      .lte('fecha', fin)
      .order('fecha', { ascending: true });
    
    if (institucion_id) query = query.eq('institucion_id', institucion_id);
    
    const { data: asistencias, error } = await query;
    
    if (error) throw error;
    
    // Calcular estadísticas
    const totalDias = Math.ceil((new Date(fin) - new Date(inicio)) / (1000 * 60 * 60 * 24)) + 1;
    const asistenciasCount = asistencias.length;
    const faltas = totalDias - asistenciasCount;
    const porcentaje = totalDias > 0 ? ((asistenciasCount / totalDias) * 100).toFixed(1) : 0;
    
    res.json({
      estudiante: {
        nombre: `${estudiante.nombre} ${estudiante.apellido}`,
        cedula: estudiante.cedula,
        grado: estudiante.grado,
        seccion: estudiante.seccion,
        carrera: estudiante.carrera
      },
      periodo: { inicio, fin },
      estadisticas: {
        total_dias: totalDias,
        asistencias: asistenciasCount,
        faltas,
        porcentaje_asistencia: porcentaje
      },
      detalle_asistencias: asistencias.map(a => ({
        fecha: a.fecha,
        hora: a.hora,
        materia: a.materias?.nombre || 'General'
      }))
    });
  } catch (error) {
    console.error('Error en generarReporteEstudiante:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getHijos,
  getAsistenciaEstudiante,
  getEstadisticasEstudiante,
  getHorariosEstudiante,
  getAlertasEstudiante,
  marcarAlertaLeida,
  generarReporteEstudiante
};