const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verificarToken, verificarAdmin } = require('../middleware/auth');

// ============================================
// FIX + LIMPIEZA (2026-08-05):
// Antes este archivo tenia su PROPIA copia de
// verificarAdmin, que llamaba a supabase.auth.getUser()
// usando el cliente 'supabase' (ahora service_role) en
// vez del cliente 'anon' correcto — mismo bug que ya
// arreglamos en middleware/auth.js.
//
// En vez de arreglar la copia duplicada, se elimina y se
// usa el verificarToken + verificarAdmin centralizados de
// middleware/auth.js — que ya estan corregidos, ya usan el
// cliente correcto (supabaseAuth), ya consultan la tabla
// 'profesores' (fuente real), y ya tienen cache de tokens.
// Asi evitamos que este archivo se desincronice de nuevo
// la proxima vez que se actualice la logica de auth.
// ============================================

router.get('/profesores', verificarToken, verificarAdmin, adminController.getProfesores);
router.post('/profesores', verificarToken, verificarAdmin, adminController.registrarProfesor);
router.put('/profesores/:id/toggle', verificarToken, verificarAdmin, adminController.toggleActivoProfesor);

module.exports = router;
