require('dotenv').config();
process.env.TZ = 'America/Tegucigalpa';

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// RUTAS
// ============================================
app.use('/api/estudiantes',   require('./src/routes/estudiantes'));
app.use('/api/asistencia',    require('./src/routes/asistencia'));
app.use('/api/admin',         require('./src/routes/admin'));
app.use('/api/materias',      require('./src/routes/materias'));
app.use('/api/instituciones', require('./src/routes/instituciones'));
app.use('/api/auth-padre',    require('./src/routes/authPadre'));
app.use('/api/padres',        require('./src/routes/padres'));
app.use('/api/excusas',       require('./src/routes/excusas'));

// ============================================
// JOB DIARIO DE FALTAS
// ============================================
try {
  const { iniciarJobFaltas } = require('./src/jobs/notificarFaltasDiarias');
  iniciarJobFaltas();
} catch (e) {
  console.warn('⚠️ Job de faltas no iniciado:', e.message);
}

// ============================================
// MANEJO DE ERRORES
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err.message);
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// 404 — sin wildcard '*' (incompatible con Express 5)
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.originalUrl}` });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📱 API disponible en: http://localhost:${PORT}/api`);
  console.log(`\n📋 Rutas registradas:`);
  console.log(`   /api/estudiantes  /api/asistencia  /api/admin`);
  console.log(`   /api/materias     /api/instituciones`);
  console.log(`   /api/auth-padre   /api/padres       /api/excusas\n`);
});
