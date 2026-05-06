const { supabase, supabaseAdmin } = require('../config/supabase');

// Obtener todos los profesores (solo administradores)
const getProfesores = async (req, res) => {
  try {
    const institucion_id = req.user?.institucion_id;

    let query = supabase
      .from('profesores')
      .select('id, nombre, email, activo, rol, created_at, institucion_id')
      .order('nombre');

    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error en getProfesores:', error);
    res.status(500).json({ error: error.message });
  }
};

// Registrar un nuevo profesor (crea usuario en auth y luego en tabla profesores)
const registrarProfesor = async (req, res) => {
  const { email, nombre, password } = req.body;
  if (!email || !nombre || !password) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'El servidor no tiene configurada la clave de administración (SUPABASE_SERVICE_KEY)' });
  }

  const institucion_id = req.user?.institucion_id;

  try {
    // 1. Crear usuario en auth usando supabaseAdmin (service_role)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre, rol: 'profesor', institucion_id }
    });
    if (authError) throw authError;

    // 2. Insertar en tabla profesores con institucion_id del admin
    const { error: insertError } = await supabase
      .from('profesores')
      .insert([{
        id: authData.user.id,
        nombre,
        email,
        activo: true,
        rol: 'profesor',
        institucion_id
      }]);
    if (insertError) throw insertError;

    res.json({ message: 'Profesor registrado correctamente', id: authData.user.id });
  } catch (error) {
    console.error('Error en registrarProfesor:', error);
    res.status(500).json({ error: error.message });
  }
};

// Activar/Desactivar profesor
const toggleActivoProfesor = async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;
  const institucion_id = req.user?.institucion_id;

  try {
    let query = supabase.from('profesores').update({ activo }).eq('id', id);
    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }
    const { error } = await query;
    if (error) throw error;
    res.json({ message: `Profesor ${activo ? 'activado' : 'desactivado'} correctamente` });
  } catch (error) {
    console.error('Error al cambiar estado:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getProfesores, registrarProfesor, toggleActivoProfesor };
