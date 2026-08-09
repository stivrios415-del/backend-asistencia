const crypto = require('crypto');
const { supabase, supabaseAuth } = require('../config/supabase');

// ============================================
// SEGURIDAD: Cache de tokens validados
// TTL 5 minutos. Clave = hash SHA-256 del token
// completo (nunca un prefijo).
// ============================================
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 5 * 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tokenCache.entries()) {
    if (now > v.expira) tokenCache.delete(k);
  }
}, 2 * 60 * 1000);

// ============================================
// VERIFICAR TOKEN
//
// FIX (2026-08-09): este middleware es compartido por rutas de
// profesor, admin Y padre (ej. guardar token de notificaciones push).
// Antes SOLO buscaba el perfil en 'profesores' — correcto para
// admin/profesor, pero causaba 401 "Usuario no registrado en el
// sistema" para CUALQUIER padre, ya que sus cuentas viven en
// 'usuarios' (confirmado por el flujo de registro: Auth -> usuarios
// -> padres). Ahora, si no se encuentra en 'profesores', se intenta
// en 'usuarios' antes de rechazar la peticion.
// ============================================
const verificarToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado - Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];

    if (!token || token.length < 20 || token.split('.').length !== 3) {
      return res.status(401).json({ error: 'Token invalido' });
    }

    // -- Verificar cache primero (clave = hash del token completo) --
    const tokenKey = hashToken(token);
    const cached   = tokenCache.get(tokenKey);
    if (cached && Date.now() < cached.expira) {
      req.user = cached.user;
      return next();
    }

    // -- Verificar con Supabase (cliente anon, NO service_role) --
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token invalido o expirado' });
    }

    // -- 1) Intentar como profesor/admin (tabla 'profesores') --
    const { data: profesorDB } = await supabase
      .from('profesores')
      .select('id, rol, institucion_id, activo')
      .eq('id', user.id)
      .single();

    let perfil = profesorDB || null;

    // -- 2) Si no es profesor/admin, intentar como padre (tabla 'usuarios') --
    // Se usa select('*') y valores por defecto tolerantes porque no
    // conocemos con certeza todas las columnas de 'usuarios' (puede no
    // tener institucion_id/activo) — evita que un esquema distinto
    // rompa la autenticacion con un error 500 en vez de simplemente
    // no encontrar coincidencia.
    if (!perfil) {
      const { data: usuarioDB } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', user.id)
        .single();

      if (usuarioDB) {
        perfil = {
          id: usuarioDB.id,
          rol: usuarioDB.rol || 'padre',
          institucion_id: usuarioDB.institucion_id ?? null,
          activo: usuarioDB.activo !== false,
        };
      }
    }

    if (!perfil) {
      return res.status(401).json({ error: 'Usuario no registrado en el sistema' });
    }

    if (perfil.activo === false) {
      return res.status(403).json({ error: 'Cuenta desactivada. Contacta al administrador.' });
    }

    const userData = {
      id:             perfil.id,
      email:          user.email,
      rol:            perfil.rol,
      institucion_id: perfil.institucion_id,
    };

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
// VERIFICAR MISMA INSTITUCION
// ============================================
const verificarInstitucion = (req, res, next) => {
  const institucionReq = req.params.institucion_id || req.query.institucion_id || req.body.institucion_id;
  if (institucionReq && req.user?.institucion_id &&
      institucionReq !== req.user.institucion_id) {
    console.warn(`🚨 Intento de acceso a otra institucion — usuario: ${req.user?.email}`);
    return res.status(403).json({ error: 'Acceso denegado. No puedes acceder a datos de otra institucion.' });
  }
  next();
};

// ============================================
// VERIFICAR ROL ESPECIFICO
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
// ============================================
const invalidarTokenCache = (token) => {
  if (token) {
    tokenCache.delete(hashToken(token));
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
