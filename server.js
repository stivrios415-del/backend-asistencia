require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const estudiantesRoutes = require('./src/routes/estudiantes');
const asistenciaRoutes = require('./src/routes/asistencia');

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

// Servir archivos estáticos desde la carpeta 'public' (index.html se servirá en /)
app.use(express.static(path.join(__dirname, 'public')));

// Rutas de la API
app.use('/api/estudiantes', estudiantesRoutes);
app.use('/api/asistencia', asistenciaRoutes);

// (Opcional) Ruta raíz solo para API si no existe index.html
// Se mantiene comentada para no interferir con el archivo estático
// app.get('/', (req, res) => {
//   res.json({ message: 'API de Asistencia funcionando' });
// });

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});