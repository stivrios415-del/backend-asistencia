const { supabase, supabaseAdmin } = require('../config/supabase');

// ============================================
// SUBIR EXCUSA MÉDICA (PADRE)
// ============================================
const subirExcusa = async (req, res) => {
  try {
    const userId = req.user.id;
    const { estudiante_cedula, fecha_ausencia, descripcion, foto_base64, extension } = req.body;

    if (!estudiante_cedula || !fecha_ausencia || !foto_base64)
      return res.status(400).json({ error: 'Cédula, fecha y foto son requeridos' });

    const { data: padreRow } = await supabase
      .from('padres').select('id').eq('user_id', userId).maybeSingle();
    if (!padreRow) return res.status(404).json({ error: 'Perfil de padre no encontrado' });

    const { data: vinculacion } = await supabase
      .from('padre_estudiante').select('padre_id')
      .eq('padre_id', padreRow.id).eq('estudiante_cedula', estudiante_cedula).maybeSingle();
    if (!vinculacion)
      return res.status(403).json({ error: 'Este estudiante no está vinculado a tu cuenta' });

    const { data: excusaExistente } = await supabase
      .from('excusas_medicas').select('id')
      .eq('padre_id', padreRow.id).eq('estudiante_cedula', estudiante_cedula)
      .eq('fecha_ausencia', fecha_ausencia).maybeSingle();
    if (excusaExistente)
      return res.status(400).json({ error: 'Ya existe una excusa para esta fecha y estudiante' });

    // ── Subir imagen con supabaseAdmin (bypasa RLS) ──
    const ext = extension || 'jpg';
    const fileName = `excusas/${padreRow.id}/${estudiante_cedula}_${fecha_ausencia}_${Date.now()}.${ext}`;
    const buffer = Buffer.from(foto_base64, 'base64');
    const storageClient = supabaseAdmin || supabase;

    const { error: uploadError } = await storageClient.storage
      .from('excusas').upload(fileName, buffer, { contentType: `image/${ext}`, upsert: false });
    if (uploadError) {
      console.error('Error subiendo imagen:', uploadError.message);
      return res.status(500).json({ error: 'Error al subir la imagen: ' + uploadError.message });
    }

    const { data: urlData } = storageClient.storage.from('excusas').getPublicUrl(fileName);

    const { data: excusa, error: dbError } = await supabase
      .from('excusas_medicas').insert({
        padre_id: padreRow.id, estudiante_cedula, fecha_ausencia,
        descripcion: descripcion || null, foto_url: urlData.publicUrl, estado: 'pendiente'
      }).select().single();

    if (dbError) {
      console.error('Error guardando excusa:', dbError.message);
      return res.status(500).json({ error: 'Error al guardar la excusa' });
    }

    console.log(`✅ Excusa subida — estudiante: ${estudiante_cedula} fecha: ${fecha_ausencia}`);
    return res.status(201).json({ success: true, excusa });

  } catch (error) {
    console.error('Error en subirExcusa:', error.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// OBTENER MIS EXCUSAS (PADRE)
// ============================================
const getMisExcusas = async (req, res) => {
  try {
    const userId = req.user.id;
    const { estudiante_cedula } = req.query;

    const { data: padreRow } = await supabase
      .from('padres').select('id').eq('user_id', userId).maybeSingle();
    if (!padreRow) return res.json([]);

    let query = supabase.from('excusas_medicas').select('*')
      .eq('padre_id', padreRow.id).order('fecha_ausencia', { ascending: false });
    if (estudiante_cedula) query = query.eq('estudiante_cedula', estudiante_cedula);

    const { data, error } = await query;
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('Error en getMisExcusas:', error.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// OBTENER EXCUSAS (ADMIN/PROFESOR)
// ============================================
const getExcusasAdmin = async (req, res) => {
  try {
    const { estado, estudiante_cedula } = req.query;

    let query = supabase.from('excusas_medicas')
      .select(`*, padres (user_id, usuarios:user_id (nombre, apellido, email))`)
      .order('created_at', { ascending: false });

    if (estado) query = query.eq('estado', estado);
    if (estudiante_cedula) query = query.eq('estudiante_cedula', estudiante_cedula);

    const { data, error } = await query;
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('Error en getExcusasAdmin:', error.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// APROBAR / RECHAZAR EXCUSA
// Al APROBAR → inserta asistencia como 'excusado'
// en TODAS las materias de la institución que
// correspondan al grado/carrera del estudiante
// ============================================
const actualizarEstadoExcusa = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, observacion_admin } = req.body;
    const userId        = req.user.id;
    const institucion_id = req.user.institucion_id;

    if (!['aprobada', 'rechazada', 'pendiente'].includes(estado))
      return res.status(400).json({ error: 'Estado inválido' });

    // 1. Obtener excusa
    const { data: excusa, error: errExcusa } = await supabase
      .from('excusas_medicas').select('*').eq('id', id).single();
    if (errExcusa || !excusa)
      return res.status(404).json({ error: 'Excusa no encontrada' });

    // 2. Actualizar estado
    const { data: excusaActualizada, error: errUpdate } = await supabase
      .from('excusas_medicas')
      .update({ estado, observacion_admin: observacion_admin || null })
      .eq('id', id).select().single();
    if (errUpdate) throw errUpdate;

    // 3. Si APROBADA → registrar excusado en asistencia
    if (estado === 'aprobada') {
      console.log(`✅ Aprobando excusa para ${excusa.estudiante_cedula} en ${excusa.fecha_ausencia}`);

      // Obtener grado y carrera del estudiante
      const { data: estudiante } = await supabase
        .from('estudiantes').select('grado, carrera, seccion')
        .eq('cedula', excusa.estudiante_cedula).maybeSingle();

      if (!estudiante) {
        console.warn('⚠️ Estudiante no encontrado para excusar');
        return res.json({ success: true, excusa: excusaActualizada });
      }

      // Buscar TODAS las materias de la institución que correspondan
      // al grado/carrera del estudiante (sin importar qué profesor la aprobó)
      let queryMaterias = supabase.from('materias').select('id, nombre, grado, carrera');
      if (institucion_id) queryMaterias = queryMaterias.eq('institucion_id', institucion_id);

      const { data: todasMaterias } = await queryMaterias;

      const materiasDelEstudiante = (todasMaterias || []).filter(m => {
        const normGradoM   = String(m.grado || '').toLowerCase().trim();
        const normGradoEst = String(estudiante.grado || '').toLowerCase().trim();
        const normCarreraM   = (m.carrera || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const normCarreraEst = (estudiante.carrera || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        return normGradoM === normGradoEst && normCarreraM === normCarreraEst;
      });

      console.log(`📚 Materias a excusar: ${materiasDelEstudiante.length}`);

      let insertados = 0;
      for (const materia of materiasDelEstudiante) {
        // Verificar si ya existe registro ese día en esa materia
        const { data: existe } = await supabase.from('asistencia').select('id, estado')
          .eq('cedula', excusa.estudiante_cedula)
          .eq('fecha', excusa.fecha_ausencia)
          .eq('materia_id', materia.id).maybeSingle();

        if (existe) {
          // Actualizar a excusado
          await supabase.from('asistencia')
            .update({ estado: 'excusado' }).eq('id', existe.id);
          console.log(`🔄 Actualizado a excusado: ${materia.nombre}`);
        } else {
          // Insertar nuevo registro excusado
          const { error: errInsert } = await supabase.from('asistencia').insert({
            cedula: excusa.estudiante_cedula,
            fecha: excusa.fecha_ausencia,
            hora: '00:00:00',
            materia_id: materia.id,
            institucion_id: institucion_id,
            estado: 'excusado'
          });
          if (!errInsert) {
            insertados++;
            console.log(`✅ Excusado insertado: ${materia.nombre}`);
          } else {
            console.warn(`⚠️ Error en ${materia.nombre}:`, errInsert.message);
          }
        }
      }
      console.log(`✅ Total excusados: ${insertados} nuevos`);
    }

    // 4. Si RECHAZADA → eliminar registros excusados
    if (estado === 'rechazada') {
      const { error: errDel } = await supabase.from('asistencia').delete()
        .eq('cedula', excusa.estudiante_cedula)
        .eq('fecha', excusa.fecha_ausencia)
        .eq('estado', 'excusado');
      if (!errDel) console.log(`❌ Excusados eliminados para ${excusa.estudiante_cedula}`);
    }

    return res.json({ success: true, excusa: excusaActualizada });

  } catch (error) {
    console.error('Error en actualizarEstadoExcusa:', error.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = { subirExcusa, getMisExcusas, getExcusasAdmin, actualizarEstadoExcusa };
