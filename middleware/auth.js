const crypto = require('crypto');
const { supabase, supabaseAuth } = require('../config/supabase');

// ============================================
// SEGURIDAD: Cache de tokens validados
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
const cacheColegios = new Map(); 

async function aplicarColegioElegido(req, userData) {
  if (userData.rol !== 'coordinador') return { user: userData };
  
  const elegido = String(req.headers['x-institucion-id'] || '').trim();
  if (!elegido) return { user: userData };
  if (!UUID_RE.test(elegido)) return { error: { status: 400, mensaje: 'Colegio inválido' } };

  const k = `${userData.red_id}|${elegido}`;
  const vence = cacheColegios.get(k);
  if (!vence || Date.now() > vence) {
    const { data } = await supabase.from('instituciones').select('id, red_id').eq('id', elegido).maybeSingle();
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

    const tokenKey = hashToken(token);
    let userData = null;
    const cached = tokenCache.get(tokenKey);

    if (cached && Date.now() < cached.expira) {
      userData = cached.user;
    } else {
      const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
      if (error || !user) return res.status(401).json({ error: 'Token invalido o expirado' });

      // 1) Profesor / admin de un colegio
      // ✅ FIX: Se usa .maybeSingle() para no lanzar error si no es profesor
      const { data: profesorDB } = await supabase
        .from('profesores').select('id, rol, institucion_id, activo').eq('id', user.id).maybeSingle();
      let perfil = profesorDB || null;

      // 2) Coordinador de una red de colegios
      if (!perfil) {
        const { data: coordDB } = await supabase
          .from('red_coordinadores').select('usuario_id, red_id, activo').eq('usuario_id', user.id).maybeSingle();
        if (coordDB) {
          perfil = { id: coordDB.usuario_id, rol: 'coordinador', institucion_id: null, activo: coordDB.activo !== false, red_id: coordDB.red_id };
        }
      }

      // 3) Padre (tabla 'usuarios')
      if (!perfil) {
        const { data: usuarioDB } = await supabase.from('usuarios').select('*').eq('id', user.id).maybeSingle();
        if (usuarioDB) {
          perfil = {
            id: usuarioDB.id, rol: usuarioDB.rol || 'padre',
            institucion_id: usuarioDB.institucion_id ?? null, activo: usuarioDB.activo !== false,
          };
        }
      }

      if (!perfil) {
        console.log(`❌ Usuario ${user.email} no encontrado en profesores, red_coordinadores ni usuarios.`);
        return res.status(401).json({ error: 'Usuario no registrado en el sistema' });
      }
      if (perfil.activo === false) return res.status(403).json({ error: 'Cuenta desactivada. Contacta al administrador.' });

      userData = {
        id: perfil.id, email: user.email, rol: perfil.rol,
        institucion_id: perfil.institucion_id, red_id: perfil.red_id ?? null,
      };
      tokenCache.set(tokenKey, { user: userData, expira: Date.now() + TOKEN_CACHE_TTL });
    }

    const r = await aplicarColegioElegido(req, userData);
    if (r.error) return res.status(r.error.status).json({ error: r.error.mensaje });
    req.user = r.user;
    next();
  } catch (error) {
    console.error('Error en verificarToken:', error.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ... (resto de funciones verificarAdmin, verificarProfesor, etc. se mantienen igual)

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
// VERIFICAR COORDINADOR
// ============================================
const verificarCoordinador = (req, res, next) => {
  if (!req.user?.red_id) {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere una cuenta de coordinador de red.' });
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
  verificarCoordinador,
  invalidarTokenCache,
};
