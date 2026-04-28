const express = require('express');
const multer = require('multer');
const router = express.Router();
const estudianteController = require('../controllers/estudianteController');

const upload = multer({ storage: multer.memoryStorage() });

router.get('/', estudianteController.getEstudiantes);
router.get('/:cedula', estudianteController.getEstudianteByCedula);
router.post('/', estudianteController.createEstudiante);
router.post('/bulk-upload', upload.single('archivo'), estudianteController.bulkUploadEstudiantes);
router.put('/:cedula', estudianteController.updateEstudiante);
router.delete('/:cedula', estudianteController.deleteEstudiante);
router.get('/grados-secciones', estudianteController.getGradosSecciones); // <-- Nueva ruta

module.exports = router;