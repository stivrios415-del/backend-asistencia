const supabase = require('../config/supabase');

const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Obtener todos los profesores (solo administradores)
const getProfesores = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profesores')
      .select('id, nombre, email, activo, rol, created_at')
      .order('nombre');
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
  try {
    // 1. Crear usuario en auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authError) throw authError;
    
    // 2. Insertar en tabla profesores
    const { error: insertError } = await supabase
      .from('profesores')
      .insert([{ id: authData.user.id, nombre, email, activo: true, rol: 'profesor' }]);
    if (insertError) throw insertError;
    
    res.json({ message: 'Profesor registrado correctamente', id: authData.user.id });
  } catch (error) {
    console.error('Error en registrarProfesor:', error);
    res.status(500).json({ error: error.message });
  }
};

// Activar/Desactivar profesor (cambiar estado)
const toggleActivoProfesor = async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body; // activo debe ser booleano
  try {
    const { error } = await supabase
      .from('profesores')
      .update({ activo })
      .eq('id', id);
    if (error) throw error;
    res.json({ message: `Profesor ${activo ? 'activado' : 'desactivado'} correctamente` });
  } catch (error) {
    console.error('Error al cambiar estado:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getProfesores, registrarProfesor, toggleActivoProfesor };