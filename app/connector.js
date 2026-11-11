'use strict';
let apiSession='',selectedPatient=null,searchPage=0,historyPages=new Map(),seenTests=new Set(),requestVersion=0,configuration={vald:false,kinvent:false},loadedTests=[];
const msg=t=>document.getElementById('apiMessage').textContent=t;
async function callApi(path,body={}){if(!apiSession){const s=await fetch('/api/session').then(r=>r.json());apiSession=s.session}const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':apiSession},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});let d=await r.json();if(!r.ok)throw Error(d.error||'No se pudo consultar');return d}
async function runApi(fn){try{msg('Consultando…');await fn()}catch(e){msg(e.name==='TimeoutError'?'La consulta tardó más de 60 segundos. Inténtalo de nuevo.':e.message||'No se pudo conectar con el servicio local. Abre INICIAR.bat.')}}
function source(){return $('apiSource').value}
function clearClinical(){data.rows=[];data.patient='';data.diagnosis='';data.doctor='';data.initialDate='';data.controlDate='';data.suggestions='';data.draft=false;editors();report()}
async function findPatients(){if(!configuration[source()])throw Error(source()==='vald'?'Abre Conexiones y configura VALD. No hace falta cerrar ni reiniciar.':'Abre Conexiones y configura Kinvent. No hace falta cerrar ni reiniciar.');const version=++requestVersion;const d=await callApi('search',{source:source(),query:$('apiQuery').value,page:searchPage,refresh:true,athlete:$('apiAthlete').checked});if(version!==requestVersion)return;$('apiPatients').replaceChildren();for(let p of d.patients||[]){let b=document.createElement('button');b.style.cssText='display:block;width:100%;text-align:left;margin:7px 0';b.textContent=p.name+(p.birth?' · '+p.birth:'')+' · '+String(p.id).slice(-6);b.onclick=()=>runApi(()=>selectPatient(p));$('apiPatients').append(b)}msg(d.patients?.length?'Selecciona al paciente correcto antes de consultar evaluaciones.':(searchPage?'Sin resultados en esta página.':'No se encontraron perfiles. En Kinvent prueba también la opción Perfil deportista.'))}

function syncSource(){
 const isVald=source()==='vald';
 $('apiSystem').closest('label').hidden=!isVald;
 $('apiAthlete').closest('label').hidden=isVald;
 $('apiPrev').hidden=isVald;$('apiNext').hidden=isVald;
 $('apiTests').textContent='Actualizar evaluaciones '+(isVald?'VALD':'Kinvent');
 $('apiSourceNote').textContent=configuration[source()]?'Fuente de datos: '+(isVald?'VALD':'Kinvent')+'. Selecciona un paciente para cargar su historial.':(isVald?'VALD':'Kinvent')+' no está configurado. Abre Conexiones para introducir sus credenciales.';
}
async function selectPatient(p){
 const same=selectedPatient?.id===p.id&&selectedPatient?.source===p.source;
 if(!same&&(data.rows.length||data.diagnosis||data.suggestions)&&!confirm('Cambiar de paciente vaciará el caso abierto. Guarda antes el informe si necesitas conservarlo. ¿Continuar?')){msg('Se conservó el paciente actual.');return;}
 selectedPatient=p;requestVersion++;
 if(!same){clearClinical();data.patient=p.name;if(!data.centerPinned)setReportCenter(p.source==='vald'?'SBS':'SB');editors();report();}
 $('selectedPatient').textContent=(p.source==='vald'?'VALD':'Kinvent')+' · '+p.name+(p.birth?' · Nac. '+p.birth:'');
 $('apiHistory').hidden=false;syncSource();await startTests();
}
async function startTests(){
 historyPages=new Map();seenTests=new Set();loadedTests=[];$('apiTestList').replaceChildren();$('apiMetrics').replaceChildren();$('apiMore').hidden=true;
 $('apiHistoryNote').textContent='Consultando historial de '+(selectedPatient?.source==='vald'?'VALD':'Kinvent')+'…';
 msg('Cargando evaluaciones…');
 try{await loadTests(false)}catch(e){$('apiHistoryNote').textContent='La consulta de evaluaciones no se completó. '+e.message;throw e;}
}

$('apiSearch').onclick=()=>{searchPage=0;runApi(findPatients)};$('apiQuery').onkeydown=e=>{if(e.key==='Enter')$('apiSearch').click()};$('apiNext').onclick=()=>{if(source()!=='kinvent')return msg('VALD busca en el listado completo de perfiles.');searchPage++;runApi(findPatients)};$('apiPrev').onclick=()=>{searchPage=Math.max(0,searchPage-1);runApi(findPatients)};
$('apiSource').onchange=()=>{requestVersion++;selectedPatient=null;searchPage=0;$('apiPatients').replaceChildren();$('apiHistory').hidden=true;$('apiMetrics').replaceChildren();syncSource();msg('Busca un paciente en la fuente elegida. El informe actual se conserva hasta seleccionar otro paciente.')};
async function loadTests(more=false) {
 if(!selectedPatient)throw Error('Selecciona primero un paciente.');
 const version=++requestVersion,patient=selectedPatient;
 const choice=patient.source==='vald'?$('apiSystem').value:'kinvent';
 const systems=choice==='all'?['dyn','fd']:[choice];
 const pending=systems.filter(system=>!more||historyPages.get(system)?.more);
 const replies=await Promise.allSettled(pending.map(system=>{
  const previous=historyPages.get(system);
  return callApi('tests',{source:patient.source,patient:patient.id,system,
   start:$('apiFrom').value,end:$('apiTo').value,page:(previous?.page||0)+1,cursor:previous?.cursor||''});
 }));
 if(version!==requestVersion)return;
 let added=0,failures=[],notes=[];
 for(const [index,reply] of replies.entries()){
  const system=pending[index],label={dyn:'DynaMo',fd:'ForceDecks',kinvent:'Kinvent'}[system];
  if(reply.status==='rejected'){
   failures.push(label+': '+reply.reason.message);
   continue;
  }
  const d=reply.value,previous=historyPages.get(system);
  const stalled=more&&d.cursor&&d.cursor===previous?.cursor;
  historyPages.set(system,{page:(previous?.page||0)+1,cursor:d.cursor||'',more:!!d.more&&!stalled});
  for(const test of d.tests||[]){
   if(seenTests.has(test.key))continue;
   seenTests.add(test.key);
   loadedTests.push(test);
   added++;
  }
  if(stalled)notes.push(label+': la paginación no avanzó.');
  if(d.received!==undefined)notes.push('Kinvent: '+d.received+' registros recibidos; '+(d.excluded||0)+' fuera del intervalo.');
 }
 renderTests();
 const hasMore=systems.some(system=>historyPages.get(system)?.more);
 $('apiMore').hidden=!hasMore;
 $('apiHistoryNote').textContent=[...notes,...failures,hasMore?'Usa Cargar más para continuar el historial.':''].filter(Boolean).join(' ');
 msg(added?added+' evaluaciones nuevas cargadas. Selecciona una para ver los KPI.':failures.length?failures.join(' · '):loadedTests.length?'Sin evaluaciones nuevas en esta página.':'No se encontraron evaluaciones en el intervalo indicado.');
}
$('apiTests').onclick=()=>runApi(startTests);
$('apiMore').onclick=()=>{$('apiMetrics').replaceChildren();runApi(()=>loadTests(true))};
function aggregate(m,how){if(!m.samples)return {...m.values};let vals={};for(const [limb,samples] of Object.entries(m.samples)){let n=samples.filter(x=>typeof x==='number'&&Number.isFinite(x));if(!n.length)continue;let side=limb.toLowerCase().includes('left')?'left':limb.toLowerCase().includes('right')?'right':'value';let v=how==='mean'?n.reduce((a,b)=>a+b,0)/n.length:how==='max'?Math.max(...n):n[+how];if(v===undefined)continue;if(vals[side]!==undefined)throw Error('Varios tipos de lado corresponden a la misma métrica. Selecciona otra métrica o registra manualmente.');vals[side]=v}return vals}
async function loadMetrics(t){const patientAtRequest=selectedPatient.id,version=++requestVersion;let d=await callApi('metrics',{key:t.key,patient:patientAtRequest});if(!selectedPatient||selectedPatient.id!==patientAtRequest||version!==requestVersion)return;$('apiMetrics').replaceChildren();const comparisons=loadComparisonCandidates(t,patientAtRequest,version);let heading=document.createElement('h3');heading.style.fontSize='14px';heading.textContent=t.title;$('apiMetrics').append(heading);const metrics=d.metrics||[];
const metricHost=document.createElement('div');
const jumps=metrics.filter(m=>m.group==='biomech');
if(jumps.length){
 const label=document.createElement('label');
 label.textContent='Parámetro del salto';
 const chooser=document.createElement('select');
 const ordered=[...jumps].sort((a,b)=>Number(b.preferred)-Number(a.preferred)||Number(b.direction==='higher')-Number(a.direction==='higher'));
 const hasDefault=ordered[0].preferred||ordered[0].direction==='higher';
 if(!hasDefault){
  const placeholder=document.createElement('option');
  placeholder.textContent='Elige un parámetro';placeholder.value='';placeholder.disabled=true;placeholder.selected=true;
  chooser.append(placeholder);
 }
 for(const [i,m] of ordered.entries()){
  const option=document.createElement('option');
  option.value=String(i);
  option.textContent=m.parameterName+' · '+(m.unit||'sin unidad identificada');
  chooser.append(option);
 }
 label.append(chooser);
 $('apiMetrics').append(label);
 chooser.onchange=()=>showMetrics([ordered[Number(chooser.value)]]);
 $('apiMetrics').append(metricHost);
 if(hasDefault)showMetrics([ordered[0]]);
}else{
 $('apiMetrics').append(metricHost);
 showMetrics(metrics);
}
msg(d.note||'Revisa las métricas antes de cargar.');
function showMetrics(items){
 metricHost.replaceChildren();
 for(const m of items){let box=document.createElement('div');box.className='roweditor';let title=document.createElement('strong');title.textContent=m.name+' · '+(m.unit||'unidad sin identificar');box.append(title);let info=document.createElement('p');info.className='hint';info.textContent=m.protocol+' · '+m.method;box.append(info);let label=document.createElement('label');label.textContent='Nombre en el informe';let name=document.createElement('input');name.value=m.name;label.append(name);box.append(label);let method=document.createElement('select');if(m.samples){method.innerHTML='<option value="max">Máximo por lado / valor</option><option value="mean">Media por lado / valor</option>';let n=Math.min(...Object.values(m.samples).map(x=>x.length));for(let i=0;i<n;i++){let o=document.createElement('option');o.value=String(i);o.textContent='Registro '+(i+1)+' por lado (revisar orden)';method.append(o)}box.append(method)}else{method.innerHTML='<option value="summary">Resumen del proveedor</option>'}
let values=document.createElement('p');values.className='hint';const show=()=>{try{let v=aggregate(m,method.value);values.textContent=['left','right','value'].filter(k=>v[k]!==undefined).map(k=>({left:'Izq.',right:'Der.',value:'Resultado'}[k])+': '+fmt(v[k])+' '+m.unit).join(' · ');const a=asym(v.left,v.right);if(m.group==='biomech'&&a!==null)values.textContent+=' · Asimetría: '+fmt(a)+' %'+(v.left===v.right?'':v.left>v.right?' izq.':' der.')}catch(e){values.textContent=e.message}};method.onchange=show;box.append(values);show();let controls=document.createElement('div');controls.className='rowtools';for(let [slot,label] of [['initial','Cargar inicial'],['control','Cargar control']]){let b=document.createElement('button');b.textContent=label;b.onclick=()=>{try{if(!m.unit)throw Error('La API no identificó la unidad. No se importa por suposición.');let v=aggregate(m,method.value);if(!Object.keys(v).length)throw Error('No hay valores numéricos para importar.');if(importMetric(m,v,slot,name.value,method.value,d,selectedPatient,t))msg('Resultado cargado como '+(slot==='initial'?'inicial':'control')+'. Revisa la fila importada y define su meta.')}catch(e){msg(e.message)}};controls.append(b)}if(m.fingerprint&&m.unit){
 const hint=document.createElement('p');
 hint.className='hint';
 hint.textContent='Buscando evaluaciones compatibles en el historial cargado…';
 box.append(hint);
 const buttons=[['firstLast','Inicial y final'],['latest','Dos últimas']].map(([mode,caption])=>{
  const button=document.createElement('button');
  button.textContent=caption;
  button.hidden=true;
  controls.append(button);
  return {button,mode};
 });
 const refresh=results=>{
  const pairs=buttons.map(({mode})=>comparisonPair(m,method.value,t,d,results,mode));
  buttons.forEach(({button,mode},i)=>{
   button.hidden=!pairs[i];
   button.onclick=()=>{if(version===requestVersion&&pairs[i])runApi(()=>applyComparison(m,method.value,name.value,t,pairs[i],mode));};
  });
  hint.textContent=pairs.some(Boolean)?'Hay dos o más evaluaciones compatibles en el historial cargado.':'Sin dos evaluaciones compatibles en el historial cargado. Puedes ampliar las fechas o usar Cargar más.';
 };
 comparisons.then(results=>{
  if(version!==requestVersion)return;
  method.onchange=()=>{show();refresh(results)};
  refresh(results);
 });
}
box.append(controls);metricHost.append(box)}
}
}
function metricShape(values) {
 const sides=Object.keys(values).filter(key=>typeof values[key]==='number'&&Number.isFinite(values[key])).sort();
 if(!sides.length||sides.includes('value')&&sides.length>1)throw Error('La métrica necesita valores numéricos con una lateralidad consistente.');
 return sides.join(',');
}
function metricRow(metric,values,method,patient,test,label) {
 const single=metricShape(values)==='value';
 const key=metric.fingerprint?[patient.source,patient.id,metric.fingerprint,method,single?'single':'sides'].join('|'):null;
 const existing=key?data.rows.find(row=>row.importKey===key):null;
 if(existing)return metric.group==='biomech'?{...existing,name:label,unit:metric.unit,direction:metric.direction||'review'}:{...existing};
 const provider=patient.source==='kinvent'?'Kinvent':test.source==='fd'?'VALD ForceDecks':'VALD DynaMo';
 const aggregation=method==='max'?'máximo':method==='mean'?'media':metric.method;
 return {group:metric.group||'force',format:single?'single':'sides',name:label,unit:metric.unit,
  protocol:[provider,metric.protocol,aggregation].filter(Boolean).join(' · '),initial:'',current:'',
  li:'',ri:'',lc:'',rc:'',metric:single?'current':data.side==='left'?'lc':'rc',op:'>=',goal:'',
  mode:'auto',direction:metric.direction||'review',importKey:key,origin:'',reviewed:false,kpi:metric.kpi||''};
}
function writeMetricSlot(row,slot,values,response,date) {
 const initial=slot==='initial';
 row[initial?'li':'lc']=values.left??'';
 row[initial?'ri':'rc']=values.right??'';
 row[initial?'initial':'current']=values.value??'';
 row[initial?'initialDate':'controlDate']=date;
 row[initial?'initialTest':'controlTest']=response.test;
}
function saveMetricRow(row,patient) {
 row.origin='Paciente '+patient.name+' · Inicial: '+(row.initialTest||'sin cargar')+' · Control: '+(row.controlTest||'sin cargar');
 row.reviewed=false;
 const index=row.importKey?data.rows.findIndex(x=>x.importKey===row.importKey):-1;
 if(index<0)data.rows.push(row);else data.rows[index]=row;
 if(row.initialDate)data.initialDate=row.initialDate;
 if(row.controlDate)data.controlDate=row.controlDate;
 editors();
 report();
}
function evaluationDate(date) {
 const parsed=new Date(date);
 return date&&!isNaN(parsed)?parsed.toLocaleDateString('es-CL',{timeZone:'America/Santiago'}):'';
}
function importMetric(metric,values,slot,label,method,response,patient,test) {
 const date=evaluationDate(response.date)||prompt('Confirma la fecha de esta evaluación (dd/mm/aaaa):');
 if(!date)throw Error('Falta la fecha de la evaluación.');
 const row=metricRow(metric,values,method,patient,test,label);
 const initial=slot==='initial';
 if(row[initial?'controlTest':'initialTest']===response.test)throw Error('Elige otra evaluación para la segunda columna.');
 const keys=initial?['li','ri','initial']:['lc','rc','current'];
 if(keys.some(key=>number(row[key])!==null)&&!confirm('Esta columna ya tiene datos. ¿Reemplazarlos?'))return false;
 writeMetricSlot(row,slot,values,response,date);
 row.comparisonMode='';
 saveMetricRow(row,patient);
 return true;
}
async function loadComparisonCandidates(test,patient,version) {
 const results=[];
 const candidates=loadedTests.filter(other=>other.key!==test.key&&other.source===test.source&&other.title===test.title&&evaluationDate(other.date));
 for(const other of candidates){
  if(requestVersion!==version)return [];
  try{
   const response=await callApi('metrics',{key:other.key,patient});
   results.push({response,test:other});
  }catch(error){continue;}
 }
 return results;
}
function attachmentCompatibility(metric,other) {
 if(other.unit!==metric.unit||other.group!==metric.group)return null;
 if(other.fingerprint===metric.fingerprint)return false;
 if(!metric.comparisonProtocol||metric.comparisonProtocol!==other.comparisonProtocol)return null;
 const normalize=value=>['','none','unknown'].includes(String(value??'').trim().toLowerCase())?'':String(value).trim();
 let unknown=false;
 for(const key of ['attachments','leftAttachment','rightAttachment']){
  const a=normalize(metric.attachments?.[key]),b=normalize(other.attachments?.[key]);
  if(a&&b&&a!==b)return null;
  if(a!==b)unknown=true;
 }
 return unknown;
}
function comparisonPair(metric,method,test,response,results,mode) {
 if(!evaluationDate(response.date))return null;
 let values,shape;
 try{values=aggregate(metric,method);shape=metricShape(values)}catch(error){return null}
 const records=[{metric,values,response,test}];
 for(const record of results){
  for(const other of record.response.metrics||[]){
   if(attachmentCompatibility(metric,other)===null)continue;
   try{
    const otherValues=aggregate(other,method);
    if(metricShape(otherValues)!==shape)continue;
    records.push({...record,metric:other,values:otherValues});
    break;
   }catch(error){continue;}
  }
 }
 const ordered=records.filter(r=>evaluationDate(r.response.date)).sort((a,b)=>Date.parse(a.response.date)-Date.parse(b.response.date));
 for(let last=ordered.length-1;last>0;last--){
  for(let first=mode==='latest'?last-1:0;first>=0&&first<last;first+=mode==='latest'?-1:1){
   const a=ordered[first],b=ordered[last];
   if(a.response.test===b.response.test||Date.parse(a.response.date)===Date.parse(b.response.date))continue;
   const unknown=attachmentCompatibility(a.metric,b.metric);
   if(unknown!==null)return {a,b,unknown};
  }
 }
 return null;
}
async function applyComparison(metric,method,label,test,pair,mode) {
 const patient=selectedPatient;
 const {a,b,unknown}=pair;
 const firstDate=evaluationDate(a.response.date);
 const lastDate=evaluationDate(b.response.date);
 const pairLabel=mode==='latest'?'Dos últimas':'Inicial y final';
 const warning=unknown?' VALD no especifica todos los accesorios en ambas evaluaciones. Confirma que el montaje fue el mismo.':'';
 if(!confirm(pairLabel+': '+firstDate+' → '+lastDate+'.'+warning+' ¿Cargar ambas evaluaciones?'))return;
 const row=metricRow(metric,aggregate(metric,method),method,patient,test,label);
 writeMetricSlot(row,'initial',a.values,a.response,firstDate);
 writeMetricSlot(row,'control',b.values,b.response,lastDate);
 row.comparisonMode=pairLabel;
 saveMetricRow(row,patient);
 msg(pairLabel+': '+firstDate+' → '+lastDate+'. Revisa la fila importada.');
}
// El HTML descargado conserva datos e identidad, sin secretos ni conexión obligatoria.
const baseSave=$('save').onclick;$('save').onclick=()=>{baseSave()};
$('apiSystem').onchange=()=>{if(selectedPatient?.source==='vald')runApi(startTests)};

function renderTests(){
 $('apiTestList').replaceChildren();
 const q=$('filterName').value.trim().toLocaleLowerCase('es'),kind=$('filterKind').value,region=$('filterRegion').value;
 const items=loadedTests.filter(t=>(!q||(t.title+' '+(t.originalTitle||'')).toLocaleLowerCase('es').includes(q))&&(!kind||t.kind===kind)&&(!region||t.region===region)).sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0));
 $('filterCount').textContent=items.length+' visibles de '+loadedTests.length+' evaluaciones cargadas. Recientes primero.';
 for(const t of items){let b=document.createElement('button');b.style.cssText='display:block;width:100%;text-align:left;margin:6px 0';const date=new Date(t.date);b.textContent=(!isNaN(date)?date.toLocaleString('es-CL',{timeZone:'America/Santiago'}):'Fecha por confirmar')+' · '+t.title;const label=document.createElement('small');label.textContent=(t.source==='fd'?'VALD ForceDecks':t.source==='dyn'?'VALD DynaMo':'Kinvent')+' · '+({force:'Fuerza',rom:'ROM',jump:'Salto',balance:'Equilibrio',endurance:'Resistencia',other:'Sin clasificar'}[t.kind]||'Revisar tipo');b.append(label);b.title=t.originalTitle||t.title;b.onclick=()=>runApi(()=>loadMetrics(t));$('apiTestList').append(b)}
}
for(const id of ['filterKind','filterRegion','filterName'])$(id).oninput=renderTests;
$('configProvider').onchange=()=>{const v=$('configProvider').value==='vald';$('valdConfigFields').hidden=!v;$('kinventConfigFields').hidden=v;$('configMessage').textContent='';};
function resetApiViews(){selectedPatient=null;loadedTests=[];seenTests=new Set();$('apiHistory').hidden=true;$('apiPatients').replaceChildren();$('apiTestList').replaceChildren();$('apiMetrics').replaceChildren();}
function showConnections(s){
 configuration={vald:!!s.vald,kinvent:!!s.kinvent};
 const label=k=>!s[k]?'sin configurar':s.verified?.[k]?'verificado ahora':s.saved?.[k]?'guardado · se comprobará al consultar':'configurado · sin comprobar en esta sesión';
 $('connection').textContent='VALD: '+label('vald')+' · Kinvent: '+label('kinvent')+' · v'+(s.version||'0.4');
 $('configRemember').disabled=!s.canRemember;
 if(!s.canRemember)$('configRemember').checked=false;
 if(s.storageWarning)$('configMessage').textContent=s.storageWarning;
 syncSource();
}
$('configConnect').onclick=async()=>{
 const provider=$('configProvider').value,b=$('configConnect');b.disabled=true;$('configMessage').textContent='Comprobando conexión…';
 try{const d=await callApi('configure',{provider,clientId:$('configClientId').value,tenant:$('configTenant').value,clientSecret:$('configSecret').value,apiKey:$('configKey').value,remember:$('configRemember').checked});requestVersion++;resetApiViews();showConnections(d);$('configSecret').value='';$('configKey').value='';$('configMessage').textContent=d.message;msg('Conexión lista. Puedes buscar pacientes sin reiniciar.');}
 catch(e){$('configMessage').textContent=e.message;}
 finally{b.disabled=false;}
};
$('configForget').onclick=async()=>{if(!confirm('Eliminar esta conexión del computador y de la sesión actual. ¿Continuar?'))return;try{const d=await callApi('configure',{provider:$('configProvider').value,forget:true});requestVersion++;resetApiViews();showConnections(d);$('configMessage').textContent=d.message;}catch(e){$('configMessage').textContent=e.message;}};
(function(){const today=new Date(),from=new Date();from.setFullYear(today.getFullYear()-1);$('apiTo').value=today.toLocaleDateString('en-CA');$('apiFrom').value=from.toLocaleDateString('en-CA');fetch('/api/session').then(r=>r.json()).then(s=>{apiSession=s.session;if(!s.vald&&s.kinvent)$('apiSource').value='kinvent';showConnections(s);if(!s.vald&&!s.kinvent){$('connectionsPanel').open=true;msg('Abre Conexiones para configurar ambos proveedores.');}}).catch(()=>{$('connection').textContent='Abre INICIAR.bat para conectar. El editor manual sigue disponible.'})})();

$('saveIdentity').onclick=async()=>{try{await callApi('identity',{brands:data.brands});$('identityMessage').textContent='Identidad guardada para ambos centros en este computador.';}catch(e){$('identityMessage').textContent=e.message;}};
fetch('/api/identity').then(r=>{if(!r.ok)throw Error('No disponible');return r.json()}).then(d=>{for(const k of ['SBS','SB'])if(d.brands?.[k])Object.assign(data.brands[k],d.brands[k]);editors();report();}).catch(()=>{});

let updateAvailable=false;
async function checkUpdates(silent=false){
 const button=$('checkUpdates');button.disabled=true;
 if(!silent)$('updateStatus').textContent='Consultando actualizaciones…';
 try{const d=await callApi('updates/check');updateAvailable=d.available;button.textContent=d.available?'Actualizar a '+d.latest:'Actualizar aplicación';$('updateStatus').textContent=d.available?'Hay una versión nueva: '+d.latest+'. La actualización conservará conexiones e identidad.':silent?'':'Ya tienes la versión más reciente ('+d.current+').';return d;}
 catch(e){if(!silent)$('updateStatus').textContent='No se pudo comprobar. Revisa internet e inténtalo de nuevo.';}
 finally{button.disabled=false;}
}
$('checkUpdates').onclick=async()=>{
 const d=await checkUpdates();if(!d?.available)return;
 if(!confirm('Se descargará e instalará la versión '+d.latest+' desde tu repositorio GitHub. La aplicación se reiniciará. Guarda el informe abierto antes de continuar. ¿Ya lo guardaste y quieres actualizar?'))return;
 $('checkUpdates').disabled=true;$('updateStatus').textContent='Descargando y verificando actualización…';
 try{const r=await callApi('updates/apply');$('updateStatus').textContent=r.message;}
 catch(e){$('updateStatus').textContent='No se completó la actualización. Puedes seguir usando esta versión. '+e.message;$('checkUpdates').disabled=false;}
};
checkUpdates(true);
