const supabase = require('../config/supabase');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

// ========== HELPER: generar XML de gráfica de barras nativo para xlsx ==========
// Genera el XML completo de un chart de barras compatible con Excel/LibreOffice
function generarChartBarrasXml(series, titulo) {
  // series = [{ nombre, valores: [num,...], categorias: [str,...] }]
  const seriesXml = series.map((s, sIdx) => {
    const valuesXml = s.valores.map((v, i) =>
      `<a:v>${v}</a:v>`
    ).join('');
    const catsXml = s.categorias.map((c) =>
      `<a:v>${escapeXml(c)}</a:v>`
    ).join('');
    const colores = ['143C65', 'E53E3E', '256D5B', 'F18F01', 'A23B72'];
    const color = colores[sIdx % colores.length];
    return `
    <c:ser>
      <c:idx val="${sIdx}"/>
      <c:order val="${sIdx}"/>
      <c:tx><c:strRef><c:f></c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escapeXml(s.nombre)}</c:v></c:pt></c:strCache></c:strRef></c:tx>
      <c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>
      <c:cat><c:strRef><c:f></c:f><c:strCache><c:ptCount val="${s.categorias.length}"/>${s.categorias.map((c, i) => `<c:pt idx="${i}"><c:v>${escapeXml(c)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:f></c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${s.valores.length}"/>${s.valores.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val>
    </c:ser>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:autoTitleDeleted val="0"/>
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXml(titulo)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        ${seriesXml}
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:barChart>
      <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
      <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
    </c:plotArea>
    <c:legend><c:legendPos val="b"/></c:legend>
    <c:plotVisOnly val="1"/>
  </c:chart>
</c:chartSpace>`;
}

// ========== HELPER: generar XML de gráfica de pie ==========
function generarChartPieXml(categorias, valores, titulo) {
  const ptsCat = categorias.map((c, i) => `<c:pt idx="${i}"><c:v>${escapeXml(c)}</c:v></c:pt>`).join('');
  const ptsVal = valores.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXml(titulo)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      <c:pieChart>
        <c:varyColors val="1"/>
        <c:ser>
          <c:idx val="0"/><c:order val="0"/>
          <c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls>
          <c:cat><c:strRef><c:f></c:f><c:strCache><c:ptCount val="${categorias.length}"/>${ptsCat}</c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:f></c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${valores.length}"/>${ptsVal}</c:numCache></c:numRef></c:val>
        </c:ser>
      </c:pieChart>
    </c:plotArea>
    <c:legend><c:legendPos val="r"/></c:legend>
    <c:plotVisOnly val="1"/>
  </c:chart>
</c:chartSpace>`;
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ========== HELPER: inyectar gráficas XML directamente en el xlsx via JSZip ==========
// Recibe un buffer ExcelJS y un array de gráficas { chartXml, nombre }
async function inyectarGraficasEnXlsx(workbookBuffer, graficas) {
  const zip = await JSZip.loadAsync(workbookBuffer);

  let wbXml = await zip.file('xl/workbook.xml').async('string');
  let wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  let contentTypes = await zip.file('[Content_Types].xml').async('string');

  const sheetMatches = wbXml.match(/<sheet /g) || [];
  let sheetCount = sheetMatches.length;
  let maxRId = (wbRels.match(/Id="rId(\d+)"/g) || []).reduce((max, m) => {
    const n = parseInt(m.match(/\d+/)[0]);
    return n > max ? n : max;
  }, 0);

  graficas.forEach((grafica, idx) => {
    sheetCount++;
    maxRId++;
    const chartId = idx + 1;
    const drawingId = idx + 1;
    const sheetId = sheetCount;
    const rId = `rId${maxRId}`;
    const nombre = grafica.nombre || `Grafica${chartId}`;

    // XML de la hoja que contiene el drawing
    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`;

    // XML del drawing que posiciona la gráfica
    const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:absoluteAnchor>
    <xdr:pos x="0" y="0"/>
    <xdr:ext cx="6858000" cy="4572000"/>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="${chartId + 2}" name="Chart ${chartId}"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="6858000" cy="4572000"/></xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:absoluteAnchor>
</xdr:wsDr>`;

    const drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartId}.xml"/>
</Relationships>`;

    const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingId}.xml"/>
</Relationships>`;

    // Guardar archivos en el ZIP
    zip.file(`xl/charts/chart${chartId}.xml`, grafica.chartXml);
    zip.file(`xl/drawings/drawing${drawingId}.xml`, drawingXml);
    zip.file(`xl/drawings/_rels/drawing${drawingId}.xml.rels`, drawingRelsXml);
    zip.file(`xl/worksheets/sheet${sheetId}.xml`, sheetXml);
    zip.file(`xl/worksheets/_rels/sheet${sheetId}.xml.rels`, sheetRelsXml);

    // Actualizar workbook.xml
    wbXml = wbXml.replace('</sheets>',
      `<sheet name="${nombre}" sheetId="${sheetId}" r:id="${rId}"/></sheets>`);

    // Actualizar workbook.xml.rels
    wbRels = wbRels.replace('</Relationships>',
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetId}.xml"/></Relationships>`);

    // Actualizar [Content_Types].xml
    contentTypes = contentTypes.replace('</Types>',
      `<Override PartName="/xl/worksheets/sheet${sheetId}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/charts/chart${chartId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` +
      `<Override PartName="/xl/drawings/drawing${drawingId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
      '</Types>');
  });

  zip.file('xl/workbook.xml', wbXml);
  zip.file('xl/_rels/workbook.xml.rels', wbRels);
  zip.file('[Content_Types].xml', contentTypes);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ========== NORMALIZAR TEXTO ==========
function normalizarTexto(str) {
  if (!str) return '';
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// ========== CONTAR FALTAS EN EL MES ==========
async function contarFaltasEnMes(cedula, año, mes) {
  const primerDia = new Date(año, mes - 1, 1).toISOString().split('T')[0];
  const hoy = new Date();
  let ultimoDia;
  if (año === hoy.getFullYear() && mes === hoy.getMonth() + 1) {
    ultimoDia = hoy.toISOString().split('T')[0];
  } else {
    ultimoDia = new Date(año, mes, 0).toISOString().split('T')[0];
  }
  const { data, error } = await supabase
    .from('asistencia').select('fecha').eq('cedula', cedula)
    .gte('fecha', primerDia).lte('fecha', ultimoDia);
  if (error) return 0;
  const diasTotales = Math.ceil((new Date(ultimoDia) - new Date(primerDia)) / (1000 * 60 * 60 * 24)) + 1;
  const faltas = diasTotales - data.length;
  return faltas > 0 ? faltas : 0;
}

// ========== HELPER: obtener filtros grado/carrera del profesor ==========
// Retorna: null = admin (sin filtro), [] = profesor sin asignaciones, [{grado,carrera}] = filtros
async function obtenerFiltrosProfesor(profesorEmail) {
  if (!profesorEmail || profesorEmail === 'all' || profesorEmail === '') return null;

  console.log('🔍 Buscando profesor con email:', profesorEmail);

  const { data: profesor, error: errProf } = await supabase
    .from('profesores').select('id, nombre').eq('email', profesorEmail.trim().toLowerCase()).single();

  // Intentar también sin normalizar si falla
  let profesorFinal = profesor;
  if (errProf || !profesor) {
    console.log('⚠️ No encontrado con lowercase, intentando sin transformar...');
    const { data: p2 } = await supabase
      .from('profesores').select('id, nombre').eq('email', profesorEmail.trim()).single();
    profesorFinal = p2;
  }

  if (!profesorFinal) {
    console.error('❌ Profesor no encontrado para email:', profesorEmail);
    return [];
  }

  console.log('✅ Profesor encontrado:', profesorFinal.nombre, '| ID:', profesorFinal.id);

  const { data: asignaciones, error: errAsig } = await supabase
    .from('profesor_asignaciones').select('grado, carrera').eq('profesor_id', profesorFinal.id);

  if (errAsig) {
    console.error('❌ Error obteniendo asignaciones:', errAsig.message);
    return [];
  }

  console.log('📋 Asignaciones encontradas:', JSON.stringify(asignaciones));
  return asignaciones || [];
}

// ========== HELPER: obtener IDs de materias del profesor ==========
async function obtenerIdsMateriaProfesor(profesorEmail) {
  if (!profesorEmail || profesorEmail === 'all' || profesorEmail === '') return null;

  const { data: profesor } = await supabase
    .from('profesores').select('id').eq('email', profesorEmail.trim()).single();
  if (!profesor) {
    const { data: p2 } = await supabase
      .from('profesores').select('id').eq('email', profesorEmail.trim().toLowerCase()).single();
    if (!p2) return [];
    const { data: materias } = await supabase.from('materias').select('id').eq('profesor_id', p2.id);
    return materias ? materias.map(m => m.id) : [];
  }

  const { data: materias } = await supabase.from('materias').select('id').eq('profesor_id', profesor.id);
  console.log('📚 Materias del profesor:', materias?.map(m => m.id));
  return materias ? materias.map(m => m.id) : [];
}

// ========== HELPER: obtener estudiantes filtrados por asignaciones ==========
async function obtenerEstudiantesFiltrados(filtros) {
  const { data, error } = await supabase
    .from('estudiantes')
    .select('cedula, nombre, apellido, grado, seccion, carrera')
    .order('apellido', { ascending: true });
  if (error) throw error;

  if (filtros === null) return data;
  if (filtros.length === 0) return [];

  return data.filter(est => {
    const gradoEst = normalizarTexto(String(est.grado));
    const carreraEst = normalizarTexto(est.carrera);
    return filtros.some(f =>
      normalizarTexto(String(f.grado)) === gradoEst &&
      normalizarTexto(f.carrera) === carreraEst
    );
  });
}

// ========== REGISTRAR ASISTENCIA ==========
const registrarAsistencia = async (req, res) => {
  const { cedula, materiaId } = req.body;
  if (!cedula) return res.status(400).json({ error: 'Cédula no proporcionada' });
  if (!materiaId) return res.status(400).json({ error: 'Debe especificar la materia/clase' });

  const { data: materia, error: errMateria } = await supabase
    .from('materias').select('grado, carrera').eq('id', materiaId).single();
  if (errMateria || !materia) return res.status(404).json({ error: 'La clase seleccionada no existe' });

  const { data: estudiante, error: errEstudiante } = await supabase
    .from('estudiantes').select('cedula, nombre, apellido, grado, seccion, carrera, foto_url')
    .eq('cedula', cedula).single();
  if (errEstudiante || !estudiante) return res.status(404).json({ error: 'Estudiante no encontrado' });

  if (normalizarTexto(String(estudiante.grado)) !== normalizarTexto(String(materia.grado)) ||
      normalizarTexto(estudiante.carrera) !== normalizarTexto(materia.carrera)) {
    return res.status(400).json({
      error: `Este estudiante no pertenece a esta clase. Solo se permite para grado ${materia.grado} - ${materia.carrera}.`
    });
  }

  const hoy = new Date().toISOString().split('T')[0];
  const ahora = new Date().toLocaleTimeString('en-GB', { hour12: false });

  const { data: yaRegistro } = await supabase.from('asistencia').select('id')
    .eq('cedula', cedula).eq('fecha', hoy).eq('materia_id', materiaId).maybeSingle();
  if (yaRegistro) return res.status(400).json({ error: 'Este estudiante ya registró asistencia en esta clase hoy', estudiante });

  const { error: errAsistencia } = await supabase.from('asistencia')
    .insert([{ cedula, fecha: hoy, hora: ahora, materia_id: materiaId }]);
  if (errAsistencia) return res.status(500).json({ error: 'Error al registrar asistencia: ' + errAsistencia.message });

  res.json({
    message: 'Asistencia registrada exitosamente',
    estudiante: {
      cedula: estudiante.cedula, nombre: estudiante.nombre, apellido: estudiante.apellido,
      grado: estudiante.grado, seccion: estudiante.seccion,
      carrera: estudiante.carrera || 'No especificada', foto_url: estudiante.foto_url || null
    },
    hora: ahora
  });
};

// ========== ASISTENCIA DEL DÍA ==========
const getAsistenciaHoy = async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const añoActual = new Date().getFullYear();
  const mesActual = new Date().getMonth() + 1;
  const { profesorEmail } = req.query;
  if (!profesorEmail) return res.status(400).json({ error: 'Se necesita el email del profesor' });

  const { data: profesor, error: errProf } = await supabase
    .from('profesores').select('id').eq('email', profesorEmail).single();
  if (errProf || !profesor) return res.status(404).json({ error: 'Profesor no encontrado' });

  const { data: materias } = await supabase.from('materias').select('id').eq('profesor_id', profesor.id);
  if (!materias || materias.length === 0) return res.json([]);

  const { data, error } = await supabase.from('asistencia').select(`
    id, fecha, hora, materia_id,
    estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url),
    materias (nombre)
  `).eq('fecha', hoy).in('materia_id', materias.map(m => m.id));
  if (error) return res.status(400).json({ error: error.message });

  const result = await Promise.all(data.map(async item => ({
    id: item.id, fecha: item.fecha, hora: item.hora,
    estudiante: item.estudiantes,
    materia_nombre: item.materias?.nombre || 'Sin materia',
    faltasEnMes: item.estudiantes?.cedula
      ? await contarFaltasEnMes(item.estudiantes.cedula, añoActual, mesActual) : 0
  })));

  res.json(result);
};

// ========== ASISTENCIA POR FECHA ==========
const getAsistenciaByFecha = async (req, res) => {
  const { fecha } = req.params;
  const { data, error } = await supabase.from('asistencia').select(`
    id, fecha, hora,
    estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)
  `).eq('fecha', fecha);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// ========== ASISTENCIA POR GRADO/SECCIÓN ==========
const getAsistenciaPorGrado = async (req, res) => {
  const { grado, seccion, fecha } = req.query;
  const fechaFiltro = fecha || new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.from('asistencia').select(`
    id, fecha, hora,
    estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)
  `).eq('fecha', fechaFiltro);
  if (error) return res.status(400).json({ error: error.message });
  let filtrados = data;
  if (grado) filtrados = filtrados.filter(a => a.estudiantes?.grado === grado);
  if (seccion) filtrados = filtrados.filter(a => a.estudiantes?.seccion === seccion);
  res.json(filtrados);
};

// ========== LIMPIAR ASISTENCIA DEL DÍA ==========
const limpiarAsistenciaHoy = async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const { error } = await supabase.from('asistencia').delete().eq('fecha', hoy);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Asistencia del día limpiada' });
};

// ========== REPORTE JSON POR RANGO ==========
const getReporteAsistencia = async (req, res) => {
  const { fechaInicio, fechaFin, profesorEmail } = req.query;

  let query = supabase.from('asistencia').select(`
    id, fecha, hora, materia_id,
    estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url),
    materias (nombre, grado, seccion, carrera, profesor_id)
  `);

  if (fechaInicio && fechaFin) query = query.gte('fecha', fechaInicio).lte('fecha', fechaFin);
  else if (fechaInicio) query = query.gte('fecha', fechaInicio);
  else if (fechaFin) query = query.lte('fecha', fechaFin);

  if (profesorEmail && profesorEmail !== 'all' && profesorEmail !== '') {
    const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail);
    if (!idsMaterias || idsMaterias.length === 0) return res.json([]);
    query = query.in('materia_id', idsMaterias);
  }

  const { data, error } = await query.order('fecha', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data.map(item => ({ ...item, materia_nombre: item.materias?.nombre || 'Sin materia' })));
};

// ========== EXPORTAR EXCEL SIMPLE ==========
const exportarReporteExcel = async (req, res) => {
  const { fechaInicio, fechaFin, usuario } = req.query;
  if (!fechaInicio || !fechaFin) return res.status(400).json({ error: 'Debe proporcionar fechaInicio y fechaFin' });

  const { data, error } = await supabase.from('asistencia').select(`
    id, fecha, hora, estudiantes (cedula, nombre, apellido, grado, seccion)
  `).gte('fecha', fechaInicio).lte('fecha', fechaFin).order('fecha', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Reporte Asistencia');
  ws.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Hora', key: 'hora', width: 10 },
    { header: 'Cédula', key: 'cedula', width: 15 }, { header: 'Nombre', key: 'nombre', width: 20 },
    { header: 'Apellido', key: 'apellido', width: 20 }, { header: 'Grado', key: 'grado', width: 8 },
    { header: 'Sección', key: 'seccion', width: 8 },
  ];
  data.forEach(item => ws.addRow({
    fecha: item.fecha, hora: item.hora,
    cedula: item.estudiantes?.cedula || '', nombre: item.estudiantes?.nombre || '',
    apellido: item.estudiantes?.apellido || '', grado: item.estudiantes?.grado || '',
    seccion: item.estudiantes?.seccion || '',
  }));

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `reporte_${fechaInicio}_a_${fechaFin}_${Date.now()}.xlsx`;
  const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  if (uploadError) return res.status(500).json({ error: 'Error al guardar archivo' });

  const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
  await supabase.from('reportes_generados').insert([{
    fecha_inicio: fechaInicio, fecha_fin: fechaFin,
    archivo_url: urlData.publicUrl, usuario: usuario || 'profesor',
  }]);
  res.json({ success: true, url: urlData.publicUrl });
};

// ========== EXPORTAR REPORTE COMPLETO POR CLASE ==========
const exportarReporteCompletoExcel = async (req, res) => {
  const { fecha, usuario, nombreProfesor, grado, seccion, profesorEmail } = req.query;
  if (!fecha) return res.status(400).json({ error: 'Debe proporcionar una fecha (YYYY-MM-DD)' });

  const subirExcelVacio = async (mensaje) => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet(`Asistencia_${fecha}`).addRow([mensaje]);
    const buf = await wb.xlsx.writeBuffer();
    const fn = `reporte_vacio_${fecha}_${Date.now()}.xlsx`;
    await supabase.storage.from('reportes').upload(fn, buf, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const { data: u } = supabase.storage.from('reportes').getPublicUrl(fn);
    return u.publicUrl;
  };

  try {
    let queryAsistencias = supabase.from('asistencia').select(`
      cedula, hora, materia_id,
      estudiantes (cedula, nombre, apellido, grado, seccion, carrera),
      materias (id, grado, seccion, carrera, nombre, profesor_id,
        profesores:profesor_id (nombre)
      )
    `).eq('fecha', fecha);

    const filtrarPorProfesor = profesorEmail && profesorEmail !== 'all' && profesorEmail !== '';
    if (filtrarPorProfesor) {
      const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail);
      if (!idsMaterias || idsMaterias.length === 0) {
        const url = await subirExcelVacio('No hay asistencias para este profesor en esta fecha.');
        return res.json({ success: true, url });
      }
      queryAsistencias = queryAsistencias.in('materia_id', idsMaterias);
    }

    if (grado) queryAsistencias = queryAsistencias.filter('materias.grado', 'eq', grado);
    if (seccion) queryAsistencias = queryAsistencias.filter('materias.seccion', 'eq', seccion);

    const { data: asistencias, error: errAsistencias } = await queryAsistencias;
    if (errAsistencias) throw errAsistencias;

    const grupos = new Map();
    asistencias.forEach(asis => {
      const materia = asis.materias;
      if (!materia) return;
      if (!grupos.has(materia.id)) grupos.set(materia.id, { materia, asistencias: [] });
      grupos.get(materia.id).asistencias.push({ estudiante: asis.estudiantes, hora: asis.hora });
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Asistencia_${fecha}`);
    const headerStyle = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF8FF' } } };
    let currentRow = 1;

    // ── NUEVO: Encabezado "INSTITUTO EVANGELICO BETHEL" ──────────────────────
    worksheet.addRow(['INSTITUTO EVANGELICO BETHEL']);
    worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
    const institutoRow = worksheet.getRow(currentRow);
    institutoRow.getCell(1).font = { bold: true, size: 16, color: { argb: 'FF143C65' } };
    institutoRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    institutoRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
    institutoRow.height = 28;
    currentRow++;
    // ─────────────────────────────────────────────────────────────────────────

    const fechaLegible = new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Tegucigalpa'
    });

    worksheet.addRow([`Fecha: ${fechaLegible}`]);
    worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
    worksheet.getRow(currentRow).font = { bold: true, size: 13 };
    currentRow++;

    if (nombreProfesor) {
      worksheet.addRow([`Generado por: ${nombreProfesor}`]);
      worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
      worksheet.getRow(currentRow).font = { italic: true };
      currentRow++;
    }

    worksheet.addRow([]); currentRow++;

    if (grupos.size === 0) {
      worksheet.addRow(['No se registraron asistencias en esta fecha.']);
    } else {
      // ── Resumen de clases al inicio ──────────────────────────────────────
      worksheet.addRow(['RESUMEN DE CLASES']);
      worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
      worksheet.getRow(currentRow).font = { bold: true, size: 11 };
      worksheet.getRow(currentRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143C65' } };
      worksheet.getRow(currentRow).getCell(1).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      currentRow++;

      worksheet.addRow(['Clase', 'Grado', 'Sección', 'Profesor', 'Presentes']);
      worksheet.getRow(currentRow).eachCell(cell => { cell.style = headerStyle; });
      currentRow++;

      const gruposOrdenadosResumen = Array.from(grupos.values()).sort((a, b) => {
        if (a.materia.grado !== b.materia.grado) return String(a.materia.grado).localeCompare(String(b.materia.grado));
        return String(a.materia.seccion).localeCompare(String(b.materia.seccion));
      });

      gruposOrdenadosResumen.forEach((grupo, idx) => {
        const mat = grupo.materia;
        const row = worksheet.addRow([
          mat.nombre || mat.carrera || 'Clase',
          `${mat.grado}°`,
          mat.seccion,
          mat.profesores?.nombre || 'Sin profesor',
          grupo.asistencias.length
        ]);
        row.getCell(5).font = { bold: true, color: { argb: 'FF256D5B' } };
        if (idx % 2 !== 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } };
        currentRow++;
      });

      // Total global
      const totalPresentes = Array.from(grupos.values()).reduce((sum, g) => sum + g.asistencias.length, 0);
      worksheet.addRow(['', '', '', 'TOTAL PRESENTES:', totalPresentes]);
      const totalRow = worksheet.getRow(currentRow);
      totalRow.getCell(4).font = { bold: true };
      totalRow.getCell(5).font = { bold: true, color: { argb: 'FF143C65' } };
      currentRow++;

      worksheet.addRow([]); currentRow++;
      worksheet.addRow([]); currentRow++;

      // ── Detalle por clase ──────────────────────────────────────────────────
      const gruposOrdenados = Array.from(grupos.values()).sort((a, b) => {
        if (a.materia.grado !== b.materia.grado) return String(a.materia.grado).localeCompare(String(b.materia.grado));
        return String(a.materia.seccion).localeCompare(String(b.materia.seccion));
      });

      for (const grupo of gruposOrdenados) {
        const mat = grupo.materia;
        const nombreProf = mat.profesores?.nombre || 'Sin profesor';
        const totalAlumnos = grupo.asistencias.length;

        worksheet.addRow([`${mat.nombre || mat.carrera || 'Clase'} — Grado ${mat.grado}° Sección ${mat.seccion}`]);
        worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
        const titleRow = worksheet.getRow(currentRow);
        titleRow.font = { bold: true, size: 12 };
        titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
        currentRow++;

        worksheet.addRow([`👤 Profesor: ${nombreProf}   |   👥 Total presentes: ${totalAlumnos}`]);
        worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
        worksheet.getRow(currentRow).font = { italic: true, size: 10, color: { argb: 'FF555555' } };
        currentRow++;

        worksheet.addRow(['Cédula', 'Nombre', 'Apellido', 'Grado (Est.)', 'Sección (Est.)', 'Carrera', 'Hora de Escaneo']);
        worksheet.getRow(currentRow).eachCell(cell => { cell.style = headerStyle; });
        currentRow++;

        for (const item of grupo.asistencias) {
          const est = item.estudiante;
          worksheet.addRow([
            est?.cedula || '', est?.nombre || '', est?.apellido || '',
            est?.grado || '', est?.seccion || '', est?.carrera || '', item.hora || ''
          ]);
          currentRow++;
        }
        worksheet.addRow([]); currentRow++;
      }
    }

    [15, 20, 20, 12, 12, 20, 15, 15].forEach((w, i) => { if (worksheet.columns[i]) worksheet.columns[i].width = w; });

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `reporte_completo_${fecha}_${Date.now()}.xlsx`;
    const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
    try {
      await supabase.from('reportes_generados').insert([{
        fecha_inicio: fecha, fecha_fin: fecha, archivo_url: urlData.publicUrl,
        usuario: usuario || 'profesor', grado: grado || null, seccion: seccion || null,
      }]);
    } catch (e) { console.warn('⚠️ Metadata no guardada:', e.message); }

    res.json({ success: true, url: urlData.publicUrl });
  } catch (error) {
    console.error('❌ Error en reporte completo:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== LISTAR REPORTES GENERADOS ==========
const getReportesGenerados = async (req, res) => {
  const { data, error } = await supabase.from('reportes_generados').select('*').order('fecha_generacion', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// ========== ESTADÍSTICAS (CORREGIDO - usa profesor_asignaciones + materias) ==========
const getEstadisticas = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, profesorEmail } = req.query;
    console.log('📊 getEstadisticas - email:', profesorEmail, '| fechas:', fechaInicio, '-', fechaFin);

    let inicio, fin;
    if (fechaInicio && fechaFin) {
      inicio = fechaInicio; fin = fechaFin;
    } else {
      const hoy = new Date();
      inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
      fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }
    console.log('📅 Rango:', inicio, '->', fin);

    const filtros = await obtenerFiltrosProfesor(profesorEmail);
    console.log('🎯 Filtros obtenidos:', JSON.stringify(filtros));

    const estudiantes = await obtenerEstudiantesFiltrados(filtros);
    console.log('👥 Estudiantes encontrados:', estudiantes.length);

    if (estudiantes.length === 0) {
      console.log('⚠️ Sin estudiantes para este filtro, devolviendo vacío');
      return res.json({ masFaltas: [], mejorRecord: [], totalDias: 0, resumenGradoCarrera: [] });
    }

    let asistencias = [];
    const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail);
    console.log('📚 IDs de materias:', idsMaterias);

    if (idsMaterias === null) {
      const { data, error } = await supabase.from('asistencia')
        .select('cedula, fecha').gte('fecha', inicio).lte('fecha', fin);
      if (error) throw error;
      asistencias = data || [];
    } else if (idsMaterias.length > 0) {
      const { data, error } = await supabase.from('asistencia')
        .select('cedula, fecha').gte('fecha', inicio).lte('fecha', fin)
        .in('materia_id', idsMaterias);
      if (error) throw error;
      asistencias = data || [];
    }
    console.log('✅ Asistencias encontradas:', asistencias.length);

    const asistenciaCount = {};
    asistencias.forEach(a => { asistenciaCount[a.cedula] = (asistenciaCount[a.cedula] || 0) + 1; });

    const totalDias = Math.ceil((new Date(fin) - new Date(inicio)) / (1000 * 60 * 60 * 24)) + 1;

    const estadisticasArr = estudiantes.map(est => {
      const count = asistenciaCount[est.cedula] || 0;
      const faltas = totalDias - count;
      return { ...est, asistencias: count, faltas: faltas > 0 ? faltas : 0, totalDias };
    });

    const masFaltas = [...estadisticasArr].sort((a, b) => b.faltas - a.faltas).slice(0, 10);
    const mejorRecord = [...estadisticasArr].sort((a, b) => b.asistencias - a.asistencias).slice(0, 10);

    const resumenMap = {};
    estadisticasArr.forEach(est => {
      const key = `${est.grado}|${est.carrera || 'Sin carrera'}`;
      if (!resumenMap[key]) resumenMap[key] = { grado: est.grado, carrera: est.carrera || 'Sin carrera', totalAsistencias: 0, totalEstudiantes: 0 };
      resumenMap[key].totalAsistencias += est.asistencias;
      resumenMap[key].totalEstudiantes++;
    });

    const resumenGradoCarrera = Object.values(resumenMap).map(item => ({
      ...item, promedioAsistencias: (item.totalAsistencias / item.totalEstudiantes).toFixed(1)
    })).sort((a, b) => {
      if (String(a.grado) !== String(b.grado)) return String(a.grado).localeCompare(String(b.grado));
      return a.carrera.localeCompare(b.carrera);
    });

    res.json({ masFaltas, mejorRecord, totalDias, resumenGradoCarrera });
  } catch (error) {
    console.error('❌ Error en estadísticas:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== EXPORTAR ESTADÍSTICAS A EXCEL (CORREGIDO) ==========
const exportarEstadisticasExcel = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, profesorEmail } = req.query;
    let inicio, fin;
    if (fechaInicio && fechaFin) {
      inicio = fechaInicio; fin = fechaFin;
    } else {
      const hoy = new Date();
      inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
      fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }

    const filtros = await obtenerFiltrosProfesor(profesorEmail);
    const estudiantes = await obtenerEstudiantesFiltrados(filtros);

    let asistencias = [];
    const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail);
    if (idsMaterias === null) {
      const { data } = await supabase.from('asistencia').select('cedula, fecha').gte('fecha', inicio).lte('fecha', fin);
      asistencias = data || [];
    } else if (idsMaterias.length > 0) {
      const { data } = await supabase.from('asistencia').select('cedula, fecha')
        .gte('fecha', inicio).lte('fecha', fin).in('materia_id', idsMaterias);
      asistencias = data || [];
    }

    const asistenciaCount = {};
    asistencias.forEach(a => { asistenciaCount[a.cedula] = (asistenciaCount[a.cedula] || 0) + 1; });
    const totalDias = Math.ceil((new Date(fin) - new Date(inicio)) / (1000 * 60 * 60 * 24)) + 1;

    const estadisticasArr = estudiantes.map(est => {
      const count = asistenciaCount[est.cedula] || 0;
      const faltas = totalDias - count;
      return { ...est, asistencias: count, faltas: faltas > 0 ? faltas : 0, totalDias };
    });

    const masFaltas = [...estadisticasArr].sort((a, b) => b.faltas - a.faltas).slice(0, 10);
    const mejorRecord = [...estadisticasArr].sort((a, b) => b.asistencias - a.asistencias).slice(0, 10);

    const resumenMap = {};
    estadisticasArr.forEach(est => {
      const key = `${est.grado}|${est.carrera || 'Sin carrera'}`;
      if (!resumenMap[key]) resumenMap[key] = { grado: est.grado, carrera: est.carrera || 'Sin carrera', totalAsistencias: 0, totalFaltas: 0, totalEstudiantes: 0 };
      resumenMap[key].totalAsistencias += est.asistencias;
      resumenMap[key].totalFaltas += est.faltas;
      resumenMap[key].totalEstudiantes++;
    });
    const resumenArray = Object.values(resumenMap).map(item => ({
      ...item,
      promedioAsistencias: item.totalEstudiantes > 0
        ? (item.totalAsistencias / item.totalEstudiantes).toFixed(1) : '0'
    })).sort((a, b) => {
      if (String(a.grado) !== String(b.grado)) return String(a.grado).localeCompare(String(b.grado));
      return a.carrera.localeCompare(b.carrera);
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sistema de Asistencia';
    workbook.created = new Date();

    const headerStyle = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143C65' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    };
    const dataStyle = {
      border: { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } }
    };
    const altRowStyle = { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } }, border: dataStyle.border };
    const colsEst = [
      { header: 'Cédula', key: 'cedula', width: 16 }, { header: 'Nombre', key: 'nombre', width: 22 },
      { header: 'Apellido', key: 'apellido', width: 22 }, { header: 'Grado', key: 'grado', width: 8 },
      { header: 'Sección', key: 'seccion', width: 10 }, { header: 'Carrera', key: 'carrera', width: 20 },
      { header: 'Asistencias', key: 'asistencias', width: 13 }, { header: 'Faltas', key: 'faltas', width: 10 },
      { header: 'Total días', key: 'totalDias', width: 12 }
    ];

    // ── Hoja 1: Dashboard ─────────────────────────────────────────────────────
    const wsDash = workbook.addWorksheet('Dashboard');
    wsDash.views = [{ showGridLines: false }];
    wsDash.mergeCells('A1:E1');
    const institutoCell = wsDash.getCell('A1');
    institutoCell.value = 'INSTITUTO EVANGELICO BETHEL';
    institutoCell.font = { bold: true, size: 16, color: { argb: 'FF143C65' } };
    institutoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
    institutoCell.alignment = { horizontal: 'center', vertical: 'middle' };
    wsDash.getRow(1).height = 30;
    wsDash.mergeCells('A2:E2');
    const titleCell = wsDash.getCell('A2');
    titleCell.value = `ESTADÍSTICAS DE ASISTENCIA — ${inicio} al ${fin}`;
    titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143C65' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    wsDash.getRow(2).height = 32;
    wsDash.mergeCells('A3:E3');
    const subCell = wsDash.getCell('A3');
    subCell.value = `Estudiantes: ${estudiantes.length}  |  Días del período: ${totalDias}  |  Asistencias totales: ${asistencias.length}`;
    subCell.font = { size: 11, color: { argb: 'FFFFFFFF' }, italic: true };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF256D5B' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    wsDash.getRow(3).height = 20;
    wsDash.addRow([]);
    wsDash.getRow(5).values = ['Grado / Carrera', 'Total Asistencias', 'Total Faltas', 'Promedio', 'Estudiantes'];
    wsDash.getRow(5).eachCell(cell => { cell.style = headerStyle; });
    wsDash.getRow(5).height = 20;
    wsDash.getColumn('A').width = 25; wsDash.getColumn('B').width = 20;
    wsDash.getColumn('C').width = 15; wsDash.getColumn('D').width = 15; wsDash.getColumn('E').width = 15;
    resumenArray.forEach((item, idx) => {
      const r = wsDash.addRow([`${item.grado}° ${item.carrera}`, item.totalAsistencias, item.totalFaltas, parseFloat(item.promedioAsistencias), item.totalEstudiantes]);
      r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; });
      r.getCell(2).font = { bold: true, color: { argb: 'FF256D5B' } };
      r.getCell(3).font = { bold: true, color: { argb: 'FFE53E3E' } };
    });

    // ── Hoja 2: Más faltas ────────────────────────────────────────────────────
    const wsFaltas = workbook.addWorksheet('Mas faltas');
    wsFaltas.views = [{ showGridLines: false }];
    wsFaltas.mergeCells('A1:I1');
    const fc = wsFaltas.getCell('A1');
    fc.value = 'TOP 10 — ALUMNOS CON MÁS FALTAS';
    fc.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    fc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE53E3E' } };
    fc.alignment = { horizontal: 'center', vertical: 'middle' };
    wsFaltas.getRow(1).height = 28;
    wsFaltas.addRow([]);
    wsFaltas.columns = colsEst;
    wsFaltas.getRow(3).values = colsEst.map(c => c.header);
    wsFaltas.getRow(3).eachCell(cell => { cell.style = headerStyle; });
    masFaltas.forEach((est, idx) => {
      const r = wsFaltas.addRow([est.cedula, est.nombre, est.apellido, est.grado, est.seccion, est.carrera, est.asistencias, est.faltas, est.totalDias]);
      r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; });
      if (est.faltas >= 3) r.getCell(8).font = { bold: true, color: { argb: 'FFCC0000' } };
    });

    // ── Hoja 3: Mejor récord ──────────────────────────────────────────────────
    const wsRecord = workbook.addWorksheet('Mejor record');
    wsRecord.views = [{ showGridLines: false }];
    wsRecord.mergeCells('A1:I1');
    const rc = wsRecord.getCell('A1');
    rc.value = 'TOP 10 — ALUMNOS CON MEJOR RÉCORD DE ASISTENCIA';
    rc.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    rc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF256D5B' } };
    rc.alignment = { horizontal: 'center', vertical: 'middle' };
    wsRecord.getRow(1).height = 28;
    wsRecord.addRow([]);
    wsRecord.columns = colsEst;
    wsRecord.getRow(3).values = colsEst.map(c => c.header);
    wsRecord.getRow(3).eachCell(cell => { cell.style = headerStyle; });
    mejorRecord.forEach((est, idx) => {
      const r = wsRecord.addRow([est.cedula, est.nombre, est.apellido, est.grado, est.seccion, est.carrera, est.asistencias, est.faltas, est.totalDias]);
      r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; });
      r.getCell(7).font = { bold: true, color: { argb: 'FF256D5B' } };
    });

    // ── Hoja 4: Resumen por grado ─────────────────────────────────────────────
    const wsResumen = workbook.addWorksheet('Resumen');
    wsResumen.views = [{ showGridLines: false }];
    wsResumen.mergeCells('A1:F1');
    const rsc = wsResumen.getCell('A1');
    rsc.value = 'RESUMEN POR GRADO Y CARRERA';
    rsc.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    rsc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143C65' } };
    rsc.alignment = { horizontal: 'center', vertical: 'middle' };
    wsResumen.getRow(1).height = 28;
    wsResumen.addRow([]);
    wsResumen.columns = [
      { header: 'Grado', key: 'grado', width: 10 }, { header: 'Carrera', key: 'carrera', width: 22 },
      { header: 'Total asistencias', key: 'totalAsistencias', width: 20 },
      { header: 'Total faltas', key: 'totalFaltas', width: 15 },
      { header: 'Total estudiantes', key: 'totalEstudiantes', width: 20 },
      { header: 'Promedio asistencias', key: 'promedioAsistencias', width: 22 }
    ];
    wsResumen.getRow(3).values = ['Grado','Carrera','Total asistencias','Total faltas','Total estudiantes','Promedio asistencias'];
    wsResumen.getRow(3).eachCell(cell => { cell.style = headerStyle; });
    resumenArray.forEach((item, idx) => {
      const r = wsResumen.addRow([item.grado, item.carrera, item.totalAsistencias, item.totalFaltas, item.totalEstudiantes, parseFloat(item.promedioAsistencias)]);
      r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; });
    });

    // ── Generar buffer base y agregar gráficas XML ────────────────────────────
    const bufferBase = await workbook.xlsx.writeBuffer();

    const graficas = [];
    if (resumenArray.length > 0) {
      const cats = resumenArray.map(r => `${r.grado}° ${r.carrera}`);
      graficas.push({
        nombre: 'Graf. Asistencias',
        chartXml: generarChartBarrasXml([
          { nombre: 'Asistencias', categorias: cats, valores: resumenArray.map(r => r.totalAsistencias) },
          { nombre: 'Faltas', categorias: cats, valores: resumenArray.map(r => r.totalFaltas) }
        ], 'Asistencias vs Faltas por Grado y Carrera')
      });
      graficas.push({
        nombre: 'Graf. Distribucion',
        chartXml: generarChartPieXml(cats, resumenArray.map(r => r.totalAsistencias), 'Distribución de Asistencias')
      });
    }
    if (masFaltas.length > 0) {
      const names = masFaltas.map(e => `${e.nombre} ${e.apellido}`);
      graficas.push({
        nombre: 'Graf. Mas Faltas',
        chartXml: generarChartBarrasXml([
          { nombre: 'Faltas', categorias: names, valores: masFaltas.map(e => e.faltas) },
          { nombre: 'Asistencias', categorias: names, valores: masFaltas.map(e => e.asistencias) }
        ], 'Top 10 Alumnos con Más Faltas')
      });
    }
    if (mejorRecord.length > 0) {
      const names = mejorRecord.map(e => `${e.nombre} ${e.apellido}`);
      graficas.push({
        nombre: 'Graf. Mejor Record',
        chartXml: generarChartBarrasXml([
          { nombre: 'Asistencias', categorias: names, valores: mejorRecord.map(e => e.asistencias) }
        ], 'Top 10 Alumnos con Mejor Récord')
      });
    }

    const finalBuffer = graficas.length > 0
      ? await inyectarGraficasEnXlsx(bufferBase, graficas)
      : bufferBase;

    const fileName = `estadisticas_${inicio}_a_${fin}_${Date.now()}.xlsx`;
    const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, finalBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
    console.log('✅ Excel con gráficas XML generado:', fileName);
    res.json({ success: true, url: urlData.publicUrl });
  } catch (error) {
    console.error('❌ Error exportando estadísticas:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  registrarAsistencia, getAsistenciaHoy, getAsistenciaByFecha, getAsistenciaPorGrado,
  limpiarAsistenciaHoy, getReporteAsistencia, exportarReporteExcel, exportarReporteCompletoExcel,
  getReportesGenerados, getEstadisticas, exportarEstadisticasExcel
};
