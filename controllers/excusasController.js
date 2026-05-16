const { supabase } = require('../config/supabase');

// ============================================
// SUBIR EXCUSA MÉDICA
// ============================================
const subirExcusa = async (req, res) => {
  try {
    const userId = req.user.id;
    const { estudiante_cedula, fecha_ausencia, descripcion, foto_base64, extension } = req.body;

    if (!estudiante_cedula || !fecha_ausencia || !foto_base64) {
      return res.status(400).json({ error: 'Cédula, fecha y foto son requeridos' });
    }

    // Obtener padre_id
    const { data: padreRow } = await supabase
      .from('padres').select('id').eq('user_id', userId).maybeSingle();
    if (!padreRow) return res.status(404).json({ error: 'Perfil de padre no encontrado' });

    // Verificar que el estudiante está vinculado al padre
    const { data: vinculacion } = await supabase
      .from('padre_estudiante')
      .select('padre_id')
      .eq('padre_id', padreRow.id)
      .eq('estudiante_cedula', estudiante_cedula)
      .maybeSingle();
    if (!vinculacion) return res.status(403).json({ error: 'Este estudiante no está vinculado a tu cuenta' });

    // Verificar que no haya excusa duplicada para esa fecha
    const { data: excusaExistente } = await supabase
      .from('excusas_medicas')
      .select('id')
      .eq('padre_id', padreRow.id)
      .eq('estudiante_cedula', estudiante_cedula)
      .eq('fecha_ausencia', fecha_ausencia)
      .maybeSingle();
    if (excusaExistente) {
      return res.status(400).json({ error: 'Ya existe una excusa para esta fecha y estudiante' });
    }

    // Subir imagen a Supabase Storage
    const ext = extension || 'jpg';
    const fileName = `excusas/${padreRow.id}/${estudiante_cedula}_${fecha_ausencia}_${Date.now()}.${ext}`;
    const buffer = Buffer.from(foto_base64, 'base64');

    const { error: uploadError } = await supabase.storage
      .from('excusas')
      .upload(fileName, buffer, {
        contentType: `image/${ext}`,
        upsert: false
      });

    if (uploadError) {
      console.error('Error subiendo imagen:', uploadError.message);
      return res.status(500).json({ error: 'Error al subir la imagen: ' + uploadError.message });
    }

    const { data: urlData } = supabase.storage.from('excusas').getPublicUrl(fileName);
    const foto_url = urlData.publicUrl;

    // Guardar en tabla
    const { data: excusa, error: dbError } = await supabase
      .from('excusas_medicas')
      .insert({
        padre_id: padreRow.id,
        estudiante_cedula,
        fecha_ausencia,
        descripcion: descripcion || null,
        foto_url,
        estado: 'pendiente'
      })
      .select()
      .single();

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
// OBTENER MIS EXCUSAS
// ============================================
const getMisExcusas = async (req, res) => {
  try {
    const userId = req.user.id;
    const { estudiante_cedula } = req.query;

    const { data: padreRow } = await supabase
      .from('padres').select('id').eq('user_id', userId).maybeSingle();
    if (!padreRow) return res.json([]);

    let query = supabase
      .from('excusas_medicas')
      .select('*')
      .eq('padre_id', padreRow.id)
      .order('fecha_ausencia', { ascending: false });

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
    const institucion_id = req.user.institucion_id;
    const { estado, estudiante_cedula } = req.query;

    let query = supabase
      .from('excusas_medicas')
      .select(`
        *,
        padres (
          user_id,
          usuarios:user_id (nombre, apellido, email)
        )
      `)
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
// ACTUALIZAR ESTADO EXCUSA (ADMIN)
// ============================================
const actualizarEstadoExcusa = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, observacion_admin } = req.body;

    if (!['aprobada', 'rechazada', 'pendiente'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const { data, error } = await supabase
      .from('excusas_medicas')
      .update({ estado, observacion_admin: observacion_admin || null })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, excusa: data });
  } catch (error) {
    console.error('Error en actualizarEstadoExcusa:', error.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  subirExcusa,
  getMisExcusas,
  getExcusasAdmin,
  actualizarEstadoExcusa
};