// profesoresController.js
const { supabase, supabaseAdmin } = require('../config/supabase');

// Función auxiliar para obtener el perfil del usuario autenticado
async function getPerfil(userId) {
  const { data, error } = await supabase
    .from('profesores')
    .select('rol, institucion_id')
    .eq('id', userId)
    .single();
  if (error) return { rol: null, institucion_id: null };
  return { rol: data?.rol || null, institucion_id: data?.institucion_id || null };
}

// Listar profesores (solo administradores)
const getProfesores = async (req, res) => {
  const userId = req.user.id;
  const { rol, institucion_id } = await getPerfil(userId);

  if (rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso no autorizado' });
  }

  let query = supabase.from('profesores').select('*');
  if (institucion_id) {
    query = query.eq('institucion_id', institucion_id);
  }
  const { data, error } = await query.order('nombre', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
};

// Registrar un nuevo profesor (solo administrador)
const registrarProfesor = async (req, res) => {
  const { email, nombre, password } = req.body;
  const userId = req.user.id;
  const { rol, institucion_id } = await getPerfil(userId);

  if (rol !== 'admin') {
    return res.status(403).json({ error: 'No tienes permiso para registrar profesores' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'El servidor no tiene configurada la clave de administración (SUPABASE_SERVICE_KEY)' });
  }

  try {
    // 1. Crear usuario en Supabase Auth usando el cliente admin (service_role)
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre, rol: 'profesor', institucion_id }
    });
    if (authError) throw authError;

    // 2. Insertar en la tabla profesores con el mismo ID de auth
    const { error: insertError } = await supabase
      .from('profesores')
      .insert({
        id: authUser.user.id,
        email,
        nombre,
        activo: true,
        institucion_id,
        rol: 'profesor'
      });
    if (insertError) throw insertError;

    res.json({
      message: 'Profesor registrado exitosamente',
      profesor: { id: authUser.user.id, email, nombre }
    });
  } catch (error) {
    console.error('❌ Error registrando profesor:', error);
    res.status(500).json({ error: error.message });
  }
};

// Activar/desactivar profesor (admin)
const toggleActivo = async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;
  const userId = req.user.id;
  const { rol, institucion_id } = await getPerfil(userId);

  if (rol !== 'admin') {
    return res.status(403).json({ error: 'No autorizado' });
  }

  let query = supabase.from('profesores').update({ activo }).eq('id', id);
  if (institucion_id) {
    query = query.eq('institucion_id', institucion_id);
  }
  const { data, error } = await query.select();
  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) {
    return res.status(403).json({ error: 'No tienes permiso para modificar este profesor' });
  }
  res.json({ message: 'Estado actualizado', profesor: data[0] });
};

module.exports = {
  getProfesores,
  registrarProfesor,
  toggleActivo
};
