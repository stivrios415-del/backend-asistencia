const express = require('express');
const router = express.Router();
const { verificarMasterAdmin } = require('../middleware/verificarMasterAdmin');
const ctrl = require('../controllers/masterAdminController');

// ✅ Público: solo compara el código, no expone nada más
router.post('/verificar', ctrl.verificarCodigoMasterAdmin);

// 🔒 Todo lo demás requiere el header x-master-admin-code
router.use(verificarMasterAdmin);

router.get('/profesores-independientes', ctrl.listarProfesoresIndependientes);
router.post('/profesores-independientes/:id/renovar', ctrl.renovarProfesorIndependiente);
router.post('/profesores-independientes/:id/desactivar', ctrl.desactivarProfesorIndependiente);

module.exports = router;
