const { supabase } = require('../config/supabase');

// ============================================
// REGISTRO DE PADRE
// ============================================
const registrarPadre = async (req, res) => {
  try {
    const { 
      email, 
      password, 
      nombre, 
      apellido, 
      telefono,
      cedula_hijo,
      institucion_id 
    } = req.body;

    // Validaciones
    if (!email || !password || !nombre || !apellido) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // 1. Verificar si el email ya está registrado en la tabla usuarios
    const { data: existingUser, error: checkError } = await supabase
      .from('usuarios')
      .select('email')
      .eq('email', email)
      .single();
    
    if (existingUser) {
      return res.status(400).json({ error: 'Este correo ya está registrado' });
    }

    // 2. Verificar si el estudiante existe (si proporcionó cédula)
    let estudianteData = null;
    if (cedula_hijo) {
      const { data: estudiante, error: errEst } = await supabase
        .from('estudiantes')
        .select('cedula, nombre, apellido, grado, seccion, carrera, institucion_id')
        .eq('cedula', cedula_hijo)
        .single();

      if (errEst || !estudiante) {
        return res.status(404).json({ error: 'No se encontró un estudiante con esa cédula' });
      }
      estudianteData = estudiante;
    }

    // 3. Crear usuario en Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { 
          nombre, 
          apellido, 
          rol: 'padre' 
        }
      }
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    if (!authData.user) {
      return res.status(400).json({ error: 'Error al crear usuario' });
    }

    // 4. Insertar en tabla usuarios
    const { data: usuarioDB, error: userError } = await supabase
      .from('usuarios')
      .insert({
        id: authData.user.id,
        email,
        nombre,
        apellido,
        telefono: telefono || null,
        rol: 'padre',
        institucion_id: institucion_id || estudianteData?.institucion_id || null
      })
      .select()
      .single();

    if (userError) {
      console.error('Error al insertar en usuarios:', userError);
      return res.status(500).json({ error: 'Error al guardar en la base de datos' });
    }

    // 5. Insertar en tabla padres
    const { data: padreData, error: padreError } = await supabase
      .from('padres')
      .insert({
        user_id: usuarioDB.id,
        cedula: `PAD-${Date.now()}`,
        telefono_adicional: telefono || null,
        institucion_id: institucion_id || estudianteData?.institucion_id || null
      })
      .select()
      .single();

    if (padreError) {
      console.error('Error al insertar en padres:', padreError);
      await supabase.from('usuarios').delete().eq('id', usuarioDB.id);
      return res.status(500).json({ error: 'Error al crear perfil de padre' });
    }

    // 6. Vincular con estudiante si proporcionó cédula
    if (cedula_hijo && estudianteData) {
      const { error: vinculacionError } = await supabase
        .from('padre_estudiante')
        .insert({
          padre_id: padreData.id,
          estudiante_cedula: cedula_hijo,
          institucion_id: institucion_id || estudianteData.institucion_id
        });

      if (vinculacionError) {
        console.warn('Error al vincular estudiante:', vinculacionError.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Registro exitoso. Ya puedes iniciar sesión.',
      user: { id: usuarioDB.id, email, nombre, apellido, rol: 'padre' },
      estudianteVinculado: !!cedula_hijo
    });

  } catch (error) {
    console.error('Error en registrarPadre:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// VINCULAR ESTUDIANTE EXISTENTE
// ============================================
const vincularEstudiante = async (req, res) => {
  try {
    const { cedula_hijo } = req.body;
    const padreId = req.user.id;

    if (!cedula_hijo) {
      return res.status(400).json({ error: 'La cédula del estudiante es requerida' });
    }

    // Verificar si el estudiante existe
    const { data: estudiante, error: errEst } = await supabase
      .from('estudiantes')
      .select('cedula, nombre, apellido, institucion_id')
      .eq('cedula', cedula_hijo)
      .single();

    if (errEst || !estudiante) {
      return res.status(404).json({ error: 'No se encontró un estudiante con esa cédula' });
    }

    // Verificar si ya está vinculado
    const { data: vinculacionExistente } = await supabase
      .from('padre_estudiante')
      .select('id')
      .eq('padre_id', padreId)
      .eq('estudiante_cedula', cedula_hijo)
      .single();

    if (vinculacionExistente) {
      return res.status(400).json({ error: 'Este estudiante ya está vinculado a tu cuenta' });
    }

    // Vincular
    const { error: vinculacionError } = await supabase
      .from('padre_estudiante')
      .insert({
        padre_id: padreId,
        estudiante_cedula: cedula_hijo,
        institucion_id: estudiante.institucion_id
      });

    if (vinculacionError) {
      return res.status(500).json({ error: 'Error al vincular estudiante' });
    }

    res.json({
      success: true,
      message: 'Estudiante vinculado exitosamente',
      estudiante: { cedula: estudiante.cedula, nombre: estudiante.nombre, apellido: estudiante.apellido }
    });

  } catch (error) {
    console.error('Error en vincularEstudiante:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// BUSCAR ESTUDIANTE PARA VINCULAR
// ============================================
const buscarEstudianteParaVincular = async (req, res) => {
  try {
    const { cedula } = req.query;
    const institucion_id = req.user.institucion_id;

    if (!cedula) {
      return res.status(400).json({ error: 'La cédula es requerida' });
    }

    // Buscar estudiante
    let query = supabase
      .from('estudiantes')
      .select('cedula, nombre, apellido, grado, seccion, carrera')
      .eq('cedula', cedula);

    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }

    const { data: estudiante, error } = await query.single();

    if (error || !estudiante) {
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }

    res.json(estudiante);
  } catch (error) {
    console.error('Error en buscarEstudianteParaVincular:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// OBTENER MIS ESTUDIANTES VINCULADOS
// ============================================
const misEstudiantesVinculados = async (req, res) => {
  try {
    const padreId = req.user.id;

    const { data, error } = await supabase
      .from('padre_estudiante')
      .select(`
        estudiante_cedula,
        estudiantes:estudiante_cedula (
          cedula, nombre, apellido, grado, seccion, carrera, foto_url
        )
      `)
      .eq('padre_id', padreId);

    if (error) throw error;

    const hijos = (data || []).map(item => ({
      cedula: item.estudiantes?.cedula,
      nombre: item.estudiantes?.nombre,
      apellido: item.estudiantes?.apellido,
      grado: item.estudiantes?.grado,
      seccion: item.estudiantes?.seccion,
      carrera: item.estudiantes?.carrera || 'General'
    }));

    res.json(hijos);
  } catch (error) {
    console.error('Error en misEstudiantesVinculados:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  registrarPadre,
  vincularEstudiante,
  buscarEstudianteParaVincular,
  misEstudiantesVinculados
};