const { supabase, supabaseAuth } = require('../config/supabase');

// ============================================
// FIX (2026-08-05): supabase.auth.getUser(token) usaba
// el cliente 'supabase' (service_role), lo que causaba
// fallos de validacion del JWT del usuario. Se cambia a
// 'supabaseAuth' (anon key), que es el cliente correcto
// para validar tokens de usuario — mismo fix aplicado ya
// en middleware/auth.js y routes/admin.js.
// ============================================

// Middleware: verifica que el token pertenece a un profesor independiente activo
const verificarProfesorIndependiente = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'No autorizado' });

  const { data: perfil, error: perfilError } = await supabase
    .from('profesores_independientes')
    .select('activo')
    .eq('id', user.id)
    .single();

  if (perfilError || !perfil) {
    return res.status(403).json({ error: 'Perfil de profesor independiente no encontrado' });
  }
  if (!perfil.activo) {
    return res.status(403).json({ error: 'Cuenta desactivada' });
  }

  req.user = user;
  next();
};

module.exports = { verificarProfesorIndependiente };
