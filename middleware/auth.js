const crypto = require('crypto');
const { supabase, supabaseAuth } = require('../config/supabase');

// ============================================
// SEGURIDAD: Cache de tokens validados
// TTL 5 minutos. Clave = hash SHA-256 del token
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
// COORDINADOR / COLEGIO ELEGIDO
// ============================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cacheColegios = new Map(); // `${red_id}|${institucion_id}` -> vence

// Un coordinador actúa como ADMIN del colegio indicado en X-Institucion-Id.
// Sin ese header solo puede usar las rutas /api/red.
async function aplicarColegioElegido(req, userData) {
  if (userData.rol !== 'coordinador') return { user: userData };
  
  const elegido = String(req.headers['x-institucion-id'] || '').trim();
  if (!elegido) return { user: userData };
  if (!UUID_RE.test(elegido)) return { error: { status: 400, mensaje: 'Colegio inválido' } };

  const k = `${userData.red_id}|${elegido}`;
  const vence = cacheColegios.get(k);
  if (!vence || Date.now() > vence) {
    const { data } = await supabase.from('instituciones').select('id, red_id').eq('id', elegido).single();
    if (!data || data.red_id !== userData.red_id) {
      return { error: { status: 403, mensaje: 'Ese colegio no pertenece a tu red' } };
    }
    cacheColegios.set(k, Date.now() + TOKEN_CACHE_TTL);
  }
  return { user: { ...userData, rol: 'admin', institucion_id: elegido } };
}

// ============================================
// VERIFICAR TOKEN
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
    let userData;

    if (cached && Date.now() < cached.expira) {
      userData = cached.user;
    } else {
      // -- Verificar con Supabase (cliente anon, NO service_role) --
      const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
      if (error || !user) {
        return res.status(401).json({ error: 'Token invalido o expirado' });
      }

      // -- 1) Intentar como profesor/admin (tabla 'profesores') --
      // ✅ FIX: Se agregó 'red_id' al select
      const { data: profesorDB } = await supabase
        .from('profesores')
        .select('id, rol, institucion_id, activo, red_id')
        .eq('id', user.id)
        .single();

      let perfil = profesorDB || null;

      // -- 2) Si no es profesor/admin, intentar como padre/coordinador (tabla 'usuarios') --
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
            red_id: usuarioDB.red_id ?? null, // ✅ FIX: Se agregó 'red_id'
          };
        }
      }

      if (!perfil) {
        return res.status(401).json({ error: 'Usuario no registrado en el sistema' });
      }

      if (perfil.activo === false) {
        return res.status(403).json({ error: 'Cuenta desactivada. Contacta al administrador.' });
      }

      userData = {
        id:             perfil.id,
        email:          user.email,
        rol:            perfil.rol,
        institucion_id: perfil.institucion_id,
        red_id:         perfil.red_id, // ✅ FIX: Agregado a userData
      };

      // Se guarda el usuario base en caché (sin la modificación del coordinador)
      tokenCache.set(tokenKey, { user: userData, expira: Date.now() + TOKEN_CACHE_TTL });
    }

    // ✅ NUEVO: Se aplica la lógica del coordinador DESPUÉS de leer/escribir la caché base
    const { user: finalUser, error: errorColegio } = await aplicarColegioElegido(req, userData);
    
    if (errorColegio) {
      return res.status(errorColegio.status).json({ error: errorColegio.mensaje });
    }

    req.user = finalUser;
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
