require('dotenv').config();
process.env.TZ = 'America/Tegucigalpa';

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CACHÉ EN MEMORIA
// ============================================
const cache = new Map();
const cacheGet = (key) => {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expira) { cache.delete(key); return null; }
  return item.valor;
};
const cacheSet = (key, valor, seg = 30) => {
  cache.set(key, { valor, expira: Date.now() + seg * 1000 });
};
const cacheDel = (prefix) => {
  for (const key of cache.keys()) { if (key.startsWith(prefix)) cache.delete(key); }
};
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache.entries()) { if (now > v.expira) cache.delete(k); }
}, 5 * 60 * 1000);
app.locals.cache = { get: cacheGet, set: cacheSet, del: cacheDel };

// ============================================
// RATE LIMITING SIMPLE (sin dependencias)
// ============================================
const rateLimitMap = new Map();
const rateLimit = (maxReq = 100, ventanaMs = 60000) => (req, res, next) => {
  const key = req.ip + ':' + req.path;
  const now = Date.now();
  const registro = rateLimitMap.get(key) || { count: 0, reset: now + ventanaMs };
  if (now > registro.reset) { registro.count = 0; registro.reset = now + ventanaMs; }
  registro.count++;
  rateLimitMap.set(key, registro);
  if (registro.count > maxReq) {
    return res.status(429).json({ error: 'Demasiadas peticiones. Intenta en un momento.' });
  }
  next();
};
// Limpiar rate limit map cada 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap.entries()) { if (now > v.reset) rateLimitMap.delete(k); }
}, 5 * 60 * 1000);

// ============================================
// MIDDLEWARES GLOBALES
// ============================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Logger
app.use((req, res, next) => {
  console.log(`📢 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Compresión manual de respuestas grandes
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    res.setHeader('Cache-Control', 'no-store');
    return originalJson(data);
  };
  next();
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memoria: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    cacheSize: cache.size,
  });
});

// ============================================
// RUTAS CON CACHÉ DONDE APLICA
// ============================================

// Middleware caché para endpoints de lectura pesada
const withCache = (seg = 30) => (req, res, next) => {
  const key = `${req.originalUrl}:${req.user?.institucion_id || 'pub'}`;
  const cached = cacheGet(key);
  if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(cached); }
  res.setHeader('X-Cache', 'MISS');
  const orig = res.json.bind(res);
  res.json = (data) => { if (res.statusCode === 200) cacheSet(key, data, seg); return orig(data); };
  next();
};

const estudiantesRoutes   = require('./routes/estudiantes');
const asistenciaRoutes    = require('./routes/asistencia');
const adminRoutes         = require('./routes/admin');
const materiasRoutes      = require('./routes/materias');
const institucionesRoutes = require('./routes/instituciones');
const authPadreRoutes     = require('./routes/authPadre');
const padresRoutes        = require('./routes/padres');
const excusasRoutes       = require('./routes/excusas');

// Rate limit agresivo para exportar Excel (max 10 req/min por IP)
const limitExcel = rateLimit(10, 60000);
// Rate limit normal (200 req/min por IP)
const limitNormal = rateLimit(200, 60000);

app.use('/api/estudiantes',                limitNormal, estudiantesRoutes);
app.use('/api/asistencia',                 limitNormal, asistenciaRoutes);
app.use('/api/admin',                      limitNormal, adminRoutes);
app.use('/api/materias',                   limitNormal, materiasRoutes);
app.use('/api/instituciones',              limitNormal, institucionesRoutes);
app.use('/api/auth-padre',                 limitNormal, authPadreRoutes);
app.use('/api/padres',                     limitNormal, padresRoutes);
app.use('/api/excusas',                    limitNormal, excusasRoutes);

// ============================================
// JOB DIARIO DE FALTAS
// ============================================
try {
  const { iniciarJobFaltas } = require('./jobs/notificarFaltasDiarias');
  iniciarJobFaltas();
} catch (e) { console.warn('⚠️ Job de faltas no iniciado:', e.message); }

// ============================================
// MANEJO DE ERRORES
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.originalUrl}` });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📱 API disponible en: http://localhost:${PORT}/api`);
  console.log(`\n📋 Rutas: estudiantes | asistencia | admin | materias`);
  console.log(`         instituciones | auth-padre | padres | excusas\n`);
});
