const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Faltan variables de entorno: SUPABASE_URL o SUPABASE_KEY');
  process.exit(1);
}
if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_KEY no configurada. Es OBLIGATORIA: el cliente principal la requiere para funcionar una vez que RLS este activo.');
  process.exit(1);
}

console.log('🔌 Conectando a Supabase...');
console.log(`📡 URL: ${supabaseUrl}`);

// ============================================
// TRES CLIENTES, CADA UNO CON UN PROPOSITO CLARO
// ============================================

// 1) Cliente principal — usado por los controladores para leer/escribir
//    tablas. Usa service_role: bypasea RLS porque el backend ya valida
//    permisos por su cuenta (verificarToken, verificarInstitucion, etc.)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'x-application-name': 'asistencia-backend' } }
});

// 2) Cliente de autenticacion — SOLO para validar el JWT del usuario
//    (supabase.auth.getUser(token) en el middleware auth.js). Debe
//    usar la anon key: mezclar service_role con la validacion de
//    tokens de usuario causa fallos de verificacion (401 en cascada).
const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'x-application-name': 'asistencia-backend-auth' } }
});

// 3) Cliente de administracion — para operaciones de auth.admin
//    (crear/eliminar usuarios). Igual a 'supabase' en cuanto a key,
//    se mantiene separado por claridad y compatibilidad con codigo
//    existente que ya usa supabaseAdmin.auth.admin.createUser().
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'x-application-name': 'asistencia-backend-admin' } }
});

// Verificacion rapida (opcional)
(async () => {
  try {
    const { error } = await supabase.from('estudiantes').select('count', { count: 'exact', head: true });
    if (error) {
      console.error('⚠️ No se pudo conectar a Supabase. Verifica URL y KEY.');
      console.error('   Detalle:', error.message);
    } else {
      console.log('✅ Conexion a Supabase exitosa (cliente principal usando service_role)');
    }
  } catch (err) {
    console.error('⚠️ Error de conexion a Supabase:', err.message);
  }
})();

module.exports = { supabase, supabaseAuth, supabaseAdmin };
