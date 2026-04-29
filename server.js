require('dotenv').config();
process.env.TZ = 'America/Tegucigalpa';

const express = require('express');
const cors = require('cors');
const path = require('path');

// ✅ Rutas corregidas: sin 'src/'
const estudiantesRoutes = require('./routes/estudiantes');
const asistenciaRoutes = require('./routes/asistencia');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de logging
app.use((req, res, next) => {
  console.log(`📢 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parseo de JSON
app.use(express.json());

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Rutas de la API
app.use('/api/estudiantes', estudiantesRoutes);
app.use('/api/asistencia', asistenciaRoutes);

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
