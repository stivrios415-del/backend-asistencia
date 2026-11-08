const { supabase } = require('../config/supabase');
const { parseExcel } = require('../utils/excelParser');

const BUCKET_FOTOS = 'fotos-estudiantes';
const CEDULA_RE = /^\d{5,20}$/;
const MAX_FILAS_EXCEL = 2000;

// Supabase devuelve máximo 1000 filas por consulta: se pagina para no perder estudiantes
async function traerTodo(construir) {
  const PAGINA = 1000;
  const todo = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await construir().range(desde, desde + PAGINA - 1);
    if (error) throw error;
    todo.push(...data);
    if (data.length < PAGINA) break;
  }
  return todo;
}

const texto = (v) => (v == null ? '' : String(v).trim());

// Colegio rural: la sección y la carrera no se usan (se guardan como 'U' y 'Rural')
async function esColegioRural(institucion_id) {
  if (!institucion_id) return false;
  const { data } = await supabase.from('instituciones').select('es_rural').eq('id', institucion_id).maybeSingle();
  return !!data?.es_rural;
}

// Borra la foto del bucket solo si es nuestra (no toca URLs externas)
async function borrarFotoSiEsNuestra(url) {
  try {
    const marca = `/${BUCKET_FOTOS}/`;
    if (url && url.includes(marca)) {
      await supabase.storage.from(BUCKET_FOTOS).remove([decodeURIComponent(url.split(marca)[1])]);
    }
  } catch { /* no es crítico */ }
}

async function mensajeDuplicado(cedula, institucion_id) {
  const { data } = await supabase.from('estudiantes')
    .select('institucion_id, archivado').eq('cedula', cedula).maybeSingle();
  if (data?.archivado && data.institucion_id === institucion_id) {
    return 'Este estudiante está en el Archivo. Restáuralo desde "Cierre de año → Archivo".';
  }
  return 'Ya existe un estudiante con esa cédula.';
}

// ========== CONSULTA PÚBLICA — para credencial del estudiante ==========
const getEstudiantePublico = async (req, res) => {
  const { cedula } = req.params;
  const { institucion_id } = req.query;

  try {
    let query = supabase
      .from('estudiantes')
      .select('cedula, nombre, apellido, grado, seccion, carrera, foto_url, institucion_id')
      .eq('cedula', cedula)
      .eq('archivado', false); // los egresados y retirados ya no se encuentran

    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }

    const { data, error } = await query.maybeSingle();

    if (error) return res.status(500).json({ error: 'Error al buscar estudiante' });
    if (!data) return res.status(404).json({ error: 'Estudiante no encontrado' });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== OBTENER TODOS LOS ESTUDIANTES (activos del colegio activo) ==========
const getEstudiantes = async (req, res) => {
  try {
    const institucion_id = req.user.institucion_id;

    // Seguridad extra: si no hay institución, no mostramos nada
    if (!institucion_id) {
      return res.status(403).json({ error: 'No tienes una institución asignada.' });
    }

    const data = await traerTodo(() => supabase
      .from('estudiantes')
      .select('*')
      .eq('institucion_id', institucion_id)
      .eq('archivado', false)
      .order('apellido', { ascending: true })
      .order('cedula'));

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== BUSCAR ESTUDIANTE POR CÉDULA (protegido) ==========
const getEstudianteByCedula = async (req, res) => {
  const { cedula } = req.params;
  try {
    const institucion_id = req.user.institucion_id;

    let query = supabase.from('estudiantes').select('*').eq('cedula', cedula).eq('archivado', false);
    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }

    const { data, error } = await query.maybeSingle();

    if (error) return res.status(500).json({ error: 'Error al buscar estudiante' });
    if (!data) return res.status(404).json({ error: 'Estudiante no encontrado' });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== CREAR ESTUDIANTE INDIVIDUAL ==========
const createEstudiante = async (req, res) => {
  try {
    const { rol, institucion_id } = req.user;

    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para crear estudiantes' });
    }
    if (!institucion_id) {
      return res.status(403).json({ error: 'No tienes una institución asignada.' });
    }

    const rural = await esColegioRural(institucion_id);
    const cedula = texto(req.body.cedula);
    const nombre = texto(req.body.nombre);
    const apellido = texto(req.body.apellido);
    const grado = texto(req.body.grado);
    const seccion = texto(req.body.seccion) || (rural ? 'U' : '');
    const carrera = texto(req.body.carrera) || (rural ? 'Rural' : '');

    if (!CEDULA_RE.test(cedula)) {
      return res.status(400).json({ error: 'La cédula debe tener solo números.' });
    }
    if (!nombre || !apellido || !grado || !seccion || !carrera) {
      return res.status(400).json({ error: 'Completa todos los campos obligatorios.' });
    }

    const { data, error } = await supabase
      .from('estudiantes')
      .insert([{ cedula, nombre, apellido, grado, seccion, carrera, institucion_id }])
      .select();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: await mensajeDuplicado(cedula, institucion_id) });
      }
      return res.status(400).json({ error: error.message });
    }
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== CARGA MASIVA DESDE EXCEL ==========
const bulkUploadEstudiantes = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const { rol, institucion_id } = req.user;

    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para realizar carga masiva' });
    }
    if (!institucion_id) {
      return res.status(403).json({ error: 'No tienes una institución asignada.' });
    }

    const rural = await esColegioRural(institucion_id);
    const filas = await parseExcel(req.file.buffer);

    if (!Array.isArray(filas) || filas.length === 0) {
      return res.status(400).json({ error: 'El archivo no tiene estudiantes.' });
    }
    if (filas.length > MAX_FILAS_EXCEL) {
      return res.status(400).json({ error: `El archivo tiene demasiadas filas (máximo ${MAX_FILAS_EXCEL}).` });
    }

    const resultados = { exitosos: [], fallidos: [] };
    const validos = [];
    const vistos = new Set();

    for (const f of filas) {
      // Solo se aceptan estas columnas: el Excel no puede traer 'archivado', 'institucion_id', etc.
      const e = {
        cedula: texto(f.cedula),
        nombre: texto(f.nombre),
        apellido: texto(f.apellido),
        grado: texto(f.grado),
        seccion: texto(f.seccion) || (rural ? 'U' : ''),
        carrera: texto(f.carrera) || (rural ? 'Rural' : ''),
      };

      let motivo = null;
      if (!CEDULA_RE.test(e.cedula)) motivo = 'Cédula inválida';
      else if (!e.nombre || !e.apellido || !e.grado) motivo = 'Faltan datos (nombre, apellido o grado)';
      else if (!e.seccion || !e.carrera) motivo = 'Faltan la sección o la carrera';
      else if (vistos.has(e.cedula)) motivo = 'Cédula repetida en el archivo';

      if (motivo) { resultados.fallidos.push({ ...f, error: motivo }); continue; }
      vistos.add(e.cedula);
      validos.push({ ...e, institucion_id });
    }

    // Inserta por lotes; si un lote falla, se reintenta fila por fila para saber cuáles fallaron
    for (let i = 0; i < validos.length; i += 100) {
      const lote = validos.slice(i, i + 100);
      const { error } = await supabase.from('estudiantes').insert(lote);
      if (!error) { resultados.exitosos.push(...lote); continue; }

      for (const e of lote) {
        const { error: errFila } = await supabase.from('estudiantes').insert([e]);
        if (!errFila) resultados.exitosos.push(e);
        else resultados.fallidos.push({
          ...e,
          error: errFila.code === '23505'
            ? 'Ya existe un estudiante con esa cédula (o está en el Archivo)'
            : errFila.message,
        });
      }
    }

    res.json({
      message: `Carga completada: ${resultados.exitosos.length} exitosos, ${resultados.fallidos.length} fallidos`,
      resultados,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ========== ACTUALIZAR ESTUDIANTE ==========
const updateEstudiante = async (req, res) => {
  const { cedula } = req.params;

  try {
    const { rol, institucion_id } = req.user;

    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para modificar estudiantes' });
    }
    if (!institucion_id) {
      return res.status(403).json({ error: 'No tienes una institución asignada.' });
    }

    // Verificar que el estudiante pertenece al colegio activo
    const { data: existing } = await supabase
      .from('estudiantes').select('institucion_id, foto_url')
      .eq('cedula', cedula).eq('institucion_id', institucion_id).maybeSingle();
    if (!existing) {
      return res.status(403).json({ error: 'No tienes permiso para modificar este estudiante' });
    }

    // Solo se cambian los campos que llegan, y ninguno puede quedar vacío
    const cambios = {};
    for (const campo of ['nombre', 'apellido', 'grado', 'seccion', 'carrera']) {
      if (req.body[campo] !== undefined) {
        const valor = texto(req.body[campo]);
        if (!valor) return res.status(400).json({ error: `El campo ${campo} no puede estar vacío` });
        cambios[campo] = valor;
      }
    }

    // foto_url solo se acepta para QUITAR la foto. Subirla se hace en /estudiante-fotos
    const quitarFoto = req.body.foto_url !== undefined && !texto(req.body.foto_url) && !!existing.foto_url;
    if (quitarFoto) cambios.foto_url = null;

    if (Object.keys(cambios).length === 0) {
      return res.status(400).json({ error: 'No hay cambios para guardar' });
    }

    const { data, error } = await supabase
      .from('estudiantes')
      .update(cambios)
      .eq('cedula', cedula)
      .eq('institucion_id', institucion_id)
      .select();

    if (error) return res.status(400).json({ error: error.message });

    if (quitarFoto) await borrarFotoSiEsNuestra(existing.foto_url);
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== ELIMINAR ESTUDIANTE ==========
const deleteEstudiante = async (req, res) => {
  const { cedula } = req.params;

  try {
    const { rol, institucion_id } = req.user;

    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para eliminar estudiantes' });
    }
    if (!institucion_id) {
      return res.status(403).json({ error: 'No tienes una institución asignada.' });
    }

    const { data: existing } = await supabase
      .from('estudiantes').select('foto_url')
      .eq('cedula', cedula).eq('institucion_id', institucion_id).maybeSingle();
    if (!existing) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este estudiante' });
    }

    const { error } = await supabase
      .from('estudiantes')
      .delete()
      .eq('cedula', cedula)
      .eq('institucion_id', institucion_id);

    if (error) {
      if (error.code === '23503') {
        return res.status(409).json({
          error: 'Este estudiante tiene asistencias o padres vinculados y no se puede eliminar. Archívalo para conservar su historial.',
        });
      }
      return res.status(400).json({ error: error.message });
    }

    await borrarFotoSiEsNuestra(existing.foto_url);
    res.json({ message: 'Estudiante eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== OBTENER GRADOS Y SECCIONES ÚNICOS ==========
const getGradosSecciones = async (req, res) => {
  try {
    const institucion_id = req.user.institucion_id;

    const data = await traerTodo(() => {
      let query = supabase.from('estudiantes')
        .select('grado, seccion')
        .eq('archivado', false)
        .order('grado', { ascending: true })
        .order('seccion', { ascending: true })
        .order('cedula');
      if (institucion_id) query = query.eq('institucion_id', institucion_id);
      return query;
    });

    const uniqueMap = new Map();
    data.forEach((item) => {
      const key = `${item.grado}|${item.seccion}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, { grado: item.grado, seccion: item.seccion });
      }
    });
    res.json(Array.from(uniqueMap.values()));
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  getEstudiantePublico,
  getEstudiantes,
  getEstudianteByCedula,
  createEstudiante,
  bulkUploadEstudiantes,
  updateEstudiante,
  deleteEstudiante,
  getGradosSecciones,
};
