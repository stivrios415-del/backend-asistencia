const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Faltan variables de entorno: SUPABASE_URL o SUPABASE_KEY');
  process.exit(1);
}

// ============================================
// FIX DE SEGURIDAD CRITICO
//
// Antes: el cliente 'supabase' (usado por TODOS los
// controladores) se creaba con la anon key. Cuando se
// activa RLS (Row Level Security) en las tablas, la
// anon key queda sujeta a esas politicas — y como no
// hay politicas permisivas definidas, el backend se
// quedaria SIN PODER LEER NI ESCRIBIR NADA en cuanto
// se active RLS.
//
// Ahora: el cliente principal usa la service_role key.
// Esto es correcto porque el backend YA implementa su
// propia capa de autorizacion (verificarToken,
// verificarInstitucion, verificarAdmin en auth.js) —
// es un entorno de confianza (corre en tu servidor,
// nunca se expone al cliente), asi que puede saltarse
// RLS de forma segura. La app movil, en cambio, SOLO
// usa la anon key para autenticacion (login), nunca
// para leer tablas directamente — por eso puede quedar
// bloqueada por RLS sin romper nada.
//
// Requiere que SUPABASE_SERVICE_KEY este configurada
// en las variables de entorno de Render.
// ============================================
if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_KEY no configurada. Es OBLIGATORIA ahora: el cliente principal la requiere para funcionar una vez que RLS este activo.');
  process.exit(1);
}

console.log('🔌 Conectando a Supabase...');
console.log(`📡 URL: ${supabaseUrl}`);

// Cliente principal — usado por TODOS los controladores.
// Ahora usa service_role: el backend es el unico punto de
// confianza que puede leer/escribir sin restricciones de RLS,
// porque ya valida permisos por su cuenta antes de llegar aqui.
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'x-application-name': 'asistencia-backend' } }
});

// Cliente de administracion (idéntico a supabase ahora, se mantiene
// como export separado por compatibilidad con el codigo existente
// que ya usa supabaseAdmin.auth.admin.createUser(), etc.)
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
      console.log('✅ Conexion a Supabase exitosa (usando service_role)');
    }
  } catch (err) {
    console.error('⚠️ Error de conexion a Supabase:', err.message);
  }
})();

module.exports = { supabase, supabaseAdmin };
