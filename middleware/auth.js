// middleware/auth.js
const supabase = require('../config/supabase');

const verificarProfesor = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'No autorizado' });
  
  // Obtener perfil desde la tabla profesores
  const { data: perfil, error: perfilError } = await supabase
    .from('profesores')
    .select('rol, institucion_id')
    .eq('id', user.id)
    .single();
  
  if (perfilError || !perfil) {
    return res.status(403).json({ error: 'Perfil de profesor no encontrado' });
  }
  if (perfil.rol !== 'profesor' && perfil.rol !== 'admin') {
    return res.status(403).json({ error: 'Se requiere rol de profesor o administrador' });
  }
  
  req.user = user;
  req.user.rol = perfil.rol;
  req.user.institucion_id = perfil.institucion_id; // ← clave para multi-tenant
  next();
};

module.exports = { verificarProfesor };
