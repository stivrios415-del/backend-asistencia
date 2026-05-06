// profesoresController.js
const supabase = require('../config/supabase');

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
  
  // Crear usuario en auth (Supabase)
  // Nota: Esto solo funciona si se usa la API de administración de Supabase con service_role key.
  // En un entorno real, podrías llamar a supabase.auth.admin.createUser.
  // Para simplificar, asumimos que ya tienes un endpoint que maneja la creación de usuarios.
  
  // Aquí deberías crear el usuario en auth y luego insertar en la tabla profesores
  // con el institucion_id del administrador.
  
  // Ejemplo simplificado (sin crear usuario en auth)
  try {
    const { data, error } = await supabase
      .from('profesores')
      .insert([{
        email,
        nombre,
        password_hash: 'pendiente', // normalmente no se guarda en texto plano
        activo: true,
        institucion_id: institucion_id, // asignar la misma institución del admin
        rol: 'profesor'
      }])
      .select();
    if (error) throw error;
    res.json({ message: 'Profesor registrado', profesor: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Activar/desactivar profesor (admin)
const toggleActivo = async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body; // booleano
  const userId = req.user.id;
  const { rol, institucion_id } = await getPerfil(userId);
  
  if (rol !== 'admin') {
    return res.status(403).json({ error: 'No autorizado' });
  }
  
  // Verificar que el profesor a modificar pertenezca a la misma institución
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