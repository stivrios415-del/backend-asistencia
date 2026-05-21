const { supabase, supabaseAdmin } = require('../config/supabase');

const subirExcusa = async (req, res) => {
  try {
    const userId = req.user.id;
    const { estudiante_cedula, fecha_ausencia, descripcion, foto_base64, extension } = req.body;
    if (!estudiante_cedula || !fecha_ausencia || !foto_base64)
      return res.status(400).json({ error: 'Cédula, fecha y foto son requeridos' });
    const { data: padreRow } = await supabase.from('padres').select('id').eq('user_id', userId).maybeSingle();
    if (!padreRow) return res.status(404).json({ error: 'Perfil de padre no encontrado' });
    const { data: vinc } = await supabase.from('padre_estudiante').select('padre_id')
      .eq('padre_id', padreRow.id).eq('estudiante_cedula', estudiante_cedula).maybeSingle();
    if (!vinc) return res.status(403).json({ error: 'Este estudiante no está vinculado a tu cuenta' });
    const { data: dup } = await supabase.from('excusas_medicas').select('id')
      .eq('padre_id', padreRow.id).eq('estudiante_cedula', estudiante_cedula)
      .eq('fecha_ausencia', fecha_ausencia).maybeSingle();
    if (dup) return res.status(400).json({ error: 'Ya existe una excusa para esta fecha y estudiante' });
    const ext = extension || 'jpg';
    const fileName = `excusas/${padreRow.id}/${estudiante_cedula}_${fecha_ausencia}_${Date.now()}.${ext}`;
    const buffer = Buffer.from(foto_base64, 'base64');
    const sc = supabaseAdmin || supabase;
    const { error: upErr } = await sc.storage.from('excusas').upload(fileName, buffer, { contentType: `image/${ext}`, upsert: false });
    if (upErr) return res.status(500).json({ error: 'Error al subir la imagen: ' + upErr.message });
    const { data: urlData } = sc.storage.from('excusas').getPublicUrl(fileName);
    const { data: excusa, error: dbErr } = await supabase.from('excusas_medicas').insert({
      padre_id: padreRow.id, estudiante_cedula, fecha_ausencia,
      descripcion: descripcion || null, foto_url: urlData.publicUrl, estado: 'pendiente'
    }).select().single();
    if (dbErr) return res.status(500).json({ error: 'Error al guardar la excusa' });
    return res.status(201).json({ success: true, excusa });
  } catch (e) {
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
};

const getMisExcusas = async (req, res) => {
  try {
    const { data: padreRow } = await supabase.from('padres').select('id').eq('user_id', req.user.id).maybeSingle();
    if (!padreRow) return res.json([]);
    let q = supabase.from('excusas_medicas').select('*').eq('padre_id', padreRow.id).order('fecha_ausencia', { ascending: false });
    if (req.query.estudiante_cedula) q = q.eq('estudiante_cedula', req.query.estudiante_cedula);
    const { data } = await q;
    return res.json(data || []);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

const getExcusasAdmin = async (req, res) => {
  try {
    let q = supabase.from('excusas_medicas')
      .select('*, padres(user_id, usuarios:user_id(nombre, apellido, email))')
      .order('created_at', { ascending: false });
    if (req.query.estado) q = q.eq('estado', req.query.estado);
    if (req.query.estudiante_cedula) q = q.eq('estudiante_cedula', req.query.estudiante_cedula);
    const { data, error } = await q;
    if (error) throw error;
    return res.json(data || []);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

const actualizarEstadoExcusa = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, observacion_admin } = req.body;
    const userId = req.user.id;
    const institucion_id = req.user.institucion_id;

    if (!['aprobada', 'rechazada', 'pendiente'].includes(estado))
      return res.status(400).json({ error: 'Estado inválido' });

    const { data: excusa } = await supabase.from('excusas_medicas').select('*').eq('id', id).single();
    if (!excusa) return res.status(404).json({ error: 'Excusa no encontrada' });

    const { data: excusaActualizada, error: errUpd } = await supabase.from('excusas_medicas')
      .update({ estado, observacion_admin: observacion_admin || null }).eq('id', id).select().single();
    if (errUpd) throw errUpd;

    if (estado === 'aprobada') {
      // Obtener grado/carrera del estudiante
      const { data: est } = await supabase.from('estudiantes')
        .select('grado, carrera').eq('cedula', excusa.estudiante_cedula).maybeSingle();
      if (!est) return res.json({ success: true, excusa: excusaActualizada });

      // Obtener las materias DEL PROFESOR QUE APRUEBA que correspondan al estudiante
      // Primero obtener el ID del profesor desde la tabla profesores
      const { data: profRow } = await supabase.from('profesores').select('id').eq('user_id', userId).maybeSingle();
      
      let materiasQuery = supabase.from('materias').select('id, nombre, grado, carrera');
      if (profRow) {
        // Profesor: solo sus materias que coincidan con grado/carrera del estudiante
        materiasQuery = materiasQuery.eq('profesor_id', profRow.id);
      } else if (institucion_id) {
        // Admin: todas las materias de la institución
        materiasQuery = materiasQuery.eq('institucion_id', institucion_id);
      }
      const { data: materias } = await materiasQuery;

      const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const materiasMatch = (materias || []).filter(m =>
        norm(m.grado) === norm(est.grado) && norm(m.carrera) === norm(est.carrera)
      );

      console.log(`✅ Excusa aprobada — ${excusa.estudiante_cedula} | fecha: ${excusa.fecha_ausencia} | materias: ${materiasMatch.length}`);

      for (const mat of materiasMatch) {
        const { data: existe } = await supabase.from('asistencia').select('id')
          .eq('cedula', excusa.estudiante_cedula).eq('fecha', excusa.fecha_ausencia)
          .eq('materia_id', mat.id).maybeSingle();
        if (existe) {
          await supabase.from('asistencia').update({ estado: 'excusado' }).eq('id', existe.id);
          console.log(`🔄 Actualizado a excusado: ${mat.nombre}`);
        } else {
          const { error: insErr } = await supabase.from('asistencia').insert({
            cedula: excusa.estudiante_cedula,
            fecha: excusa.fecha_ausencia,
            hora: '00:00:00',
            materia_id: mat.id,
            institucion_id: mat.institucion_id || institucion_id,
            estado: 'excusado'
          });
          if (!insErr) console.log(`✅ Insertado excusado: ${mat.nombre}`);
          else console.warn(`⚠️ Error en ${mat.nombre}:`, insErr.message);
        }
      }
    }

    if (estado === 'rechazada') {
      await supabase.from('asistencia').delete()
        .eq('cedula', excusa.estudiante_cedula)
        .eq('fecha', excusa.fecha_ausencia)
        .eq('estado', 'excusado');
    }

    return res.json({ success: true, excusa: excusaActualizada });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

module.exports = { subirExcusa, getMisExcusas, getExcusasAdmin, actualizarEstadoExcusa };
