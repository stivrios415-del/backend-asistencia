const { supabase } = require('../config/supabase');

// ============================================
// SEGURIDAD: Cache de tokens validados
// Evita verificar el mismo token en cada req
// TTL 5 minutos
// ============================================
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tokenCache.entries()) {
    if (now > v.expira) tokenCache.delete(k);
  }
}, 2 * 60 * 1000);

// ============================================
// VERIFICAR TOKEN
// ============================================
const verificarToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Validar formato del header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado - Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];

    // Validar que el token no esté vacío o sea demasiado corto
    if (!token || token.length < 20) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    // ── Verificar cache primero ──
    const tokenKey = token.substring(0, 32); // Usar prefijo como key
    const cached   = tokenCache.get(tokenKey);
    if (cached && Date.now() < cached.expira) {
      req.user = cached.user;
      return next();
    }

    // ── Verificar con Supabase ──
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    // ── Verificar en base de datos ──
    const { data: usuarioDB, error: dbError } = await supabase
      .from('usuarios')
      .select('id, rol, institucion_id, activo')
      .eq('email', user.email)
      .single();

    if (dbError || !usuarioDB) {
      return res.status(401).json({ error: 'Usuario no registrado en el sistema' });
    }

    // ── Verificar si el usuario está activo ──
    if (usuarioDB.activo === false) {
      return res.status(403).json({ error: 'Cuenta desactivada. Contacta al administrador.' });
    }

    const userData = {
      id:             usuarioDB.id,
      email:          user.email,
      rol:            usuarioDB.rol,
      institucion_id: usuarioDB.institucion_id,
    };

    // Guardar en cache
    tokenCache.set(tokenKey, { user: userData, expira: Date.now() + TOKEN_CACHE_TTL });

    req.user = userData;
    next();
  } catch (error) {
    console.error('Error en verificarToken:', error.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// VERIFICAR ADMIN
// ============================================
const verificarAdmin = (req, res, next) => {
  if (req.user?.rol !== 'admin') {
    console.warn(`🚨 Acceso denegado admin — usuario: ${req.user?.email} rol: ${req.user?.rol}`);
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
  }
  next();
};

// ============================================
// VERIFICAR PROFESOR
// ============================================
const verificarProfesor = [
  verificarToken,
  (req, res, next) => {
    if (req.user?.rol !== 'profesor' && req.user?.rol !== 'admin') {
      console.warn(`🚨 Acceso denegado profesor — usuario: ${req.user?.email} rol: ${req.user?.rol}`);
      return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de profesor.' });
    }
    next();
  }
];

// ============================================
// VERIFICAR PADRE
// ============================================
const verificarPadre = (req, res, next) => {
  if (req.user?.rol !== 'padre') {
    console.warn(`🚨 Acceso denegado padre — usuario: ${req.user?.email} rol: ${req.user?.rol}`);
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de padre.' });
  }
  next();
};

// ============================================
// VERIFICAR MISMA INSTITUCIÓN
// Previene que un usuario acceda a datos
// de otra institución aunque tenga token válido
// ============================================
const verificarInstitucion = (req, res, next) => {
  const institucionReq = req.params.institucion_id || req.query.institucion_id || req.body.institucion_id;
  if (institucionReq && req.user?.institucion_id &&
      institucionReq !== req.user.institucion_id) {
    console.warn(`🚨 Intento de acceso a otra institución — usuario: ${req.user?.email}`);
    return res.status(403).json({ error: 'Acceso denegado. No puedes acceder a datos de otra institución.' });
  }
  next();
};

// ============================================
// VERIFICAR ROL ESPECÍFICO
// ============================================
const verificarRol = (rolesPermitidos) => {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.user?.rol)) {
      return res.status(403).json({
        error: `Acceso denegado. Roles permitidos: ${rolesPermitidos.join(', ')}`
      });
    }
    next();
  };
};

// ============================================
// INVALIDAR TOKEN DEL CACHE
// Llamar cuando el usuario hace logout
// ============================================
const invalidarTokenCache = (token) => {
  if (token) {
    const key = token.substring(0, 32);
    tokenCache.delete(key);
  }
};

module.exports = {
  verificarToken,
  verificarAdmin,
  verificarProfesor,
  verificarPadre,
  verificarInstitucion,
  verificarRol,
  invalidarTokenCache,
};
