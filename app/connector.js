'use strict';
let apiSession='',selectedPatient=null,searchPage=0,listPage=1,cursor='',seenTests=new Set(),requestVersion=0,configuration={vald:false,kinvent:false},loadedTests=[];
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
 if(!same){clearClinical();data.patient=p.name;if(!data.centerPinned)data.center=p.source==='vald'?'SBS':'SB';editors();report();}
 $('selectedPatient').textContent=(p.source==='vald'?'VALD':'Kinvent')+' · '+p.name+(p.birth?' · Nac. '+p.birth:'');
 $('apiHistory').hidden=false;syncSource();await startTests();
}
async function startTests(){
 listPage=1;cursor='';seenTests=new Set();loadedTests=[];$('apiTestList').replaceChildren();$('apiMetrics').replaceChildren();$('apiMore').hidden=true;
 $('apiHistoryNote').textContent='Consultando historial de '+(selectedPatient?.source==='vald'?'VALD':'Kinvent')+'…';
 msg('Cargando evaluaciones…');
 try{await loadTests(false)}catch(e){$('apiHistoryNote').textContent='La consulta de evaluaciones no se completó. '+e.message;throw e;}
}

$('apiSearch').onclick=()=>{searchPage=0;runApi(findPatients)};$('apiQuery').onkeydown=e=>{if(e.key==='Enter')$('apiSearch').click()};$('apiNext').onclick=()=>{if(source()!=='kinvent')return msg('VALD busca en el listado completo de perfiles.');searchPage++;runApi(findPatients)};$('apiPrev').onclick=()=>{searchPage=Math.max(0,searchPage-1);runApi(findPatients)};
$('apiSource').onchange=()=>{requestVersion++;selectedPatient=null;searchPage=0;$('apiPatients').replaceChildren();$('apiHistory').hidden=true;$('apiMetrics').replaceChildren();syncSource();msg('Busca un paciente en la fuente elegida. El informe actual se conserva hasta seleccionar otro paciente.')};
async function loadTests(more=false){if(!selectedPatient)throw Error('Selecciona primero un paciente.');const version=++requestVersion;const d=await callApi('tests',{source:selectedPatient.source,patient:selectedPatient.id,system:selectedPatient.source==='vald'?$('apiSystem').value:undefined,start:$('apiFrom').value,end:$('apiTo').value,page:listPage,cursor:more?cursor:''});if(version!==requestVersion)return;let added=0;for(let t of d.tests||[]){if(seenTests.has(t.key))continue;seenTests.add(t.key);added++;loadedTests.push(t)}renderTests();let stalled=more&&d.cursor&&d.cursor===cursor;cursor=d.cursor||'';$('apiMore').hidden=!d.more||stalled;$('apiHistoryNote').textContent=(d.received!==undefined?'Kinvent: '+d.received+' registros recibidos; '+(d.excluded||0)+' fuera del intervalo. ':'')+(d.note||'')+(stalled?' La paginación no avanzó; no se afirma que el historial esté completo.':'');msg(added?added+' evaluaciones cargadas desde '+(selectedPatient.source==='vald'?'VALD':'Kinvent')+'. Selecciona una para ver los KPI.':d.more?'Sin pruebas nuevas en esta respuesta. Usa Cargar más si está disponible.':(d.received?'Hay registros en Kinvent, pero no coinciden con el intervalo. Amplía las fechas.':'La consulta respondió sin evaluaciones para este perfil. Comprueba el perfil y las fechas.'));}
$('apiTests').onclick=()=>runApi(startTests);$('apiMore').onclick=()=>{listPage++;runApi(()=>loadTests(true))};
function aggregate(m,how){if(!m.samples)return {...m.values};let vals={};for(const [limb,samples] of Object.entries(m.samples)){let n=samples.filter(x=>typeof x==='number'&&Number.isFinite(x));if(!n.length)continue;let side=limb.toLowerCase().includes('left')?'left':limb.toLowerCase().includes('right')?'right':'value';let v=how==='mean'?n.reduce((a,b)=>a+b,0)/n.length:how==='max'?Math.max(...n):n[+how];if(v===undefined)continue;if(vals[side]!==undefined)throw Error('Varios tipos de lado corresponden a la misma métrica. Selecciona otra métrica o registra manualmente.');vals[side]=v}return vals}
async function loadMetrics(t){const patientAtRequest=selectedPatient.id,version=++requestVersion;let d=await callApi('metrics',{key:t.key,patient:patientAtRequest});if(!selectedPatient||selectedPatient.id!==patientAtRequest||version!==requestVersion)return;$('apiMetrics').replaceChildren();let heading=document.createElement('h3');heading.style.fontSize='14px';heading.textContent=t.title;$('apiMetrics').append(heading);for(let m of d.metrics||[]){let box=document.createElement('div');box.className='roweditor';let title=document.createElement('strong');title.textContent=m.name+' · '+(m.unit||'unidad sin identificar');box.append(title);let info=document.createElement('p');info.className='hint';info.textContent=m.protocol+' · '+m.method;box.append(info);let label=document.createElement('label');label.textContent='Nombre en el informe';let name=document.createElement('input');name.value=m.name;label.append(name);box.append(label);let method=document.createElement('select');if(m.samples){method.innerHTML='<option value="max">Máximo por lado / valor</option><option value="mean">Media por lado / valor</option>';let n=Math.min(...Object.values(m.samples).map(x=>x.length));for(let i=0;i<n;i++){let o=document.createElement('option');o.value=String(i);o.textContent='Registro '+(i+1)+' por lado (revisar orden)';method.append(o)}box.append(method)}else{method.innerHTML='<option value="summary">Resumen del proveedor</option>'}
let values=document.createElement('p');values.className='hint';const show=()=>{try{let v=aggregate(m,method.value);values.textContent=Object.entries(v).map(([k,x])=>({left:'Izq.',right:'Der.',value:'Único'}[k])+': '+fmt(x)+' '+m.unit).join(' · ')}catch(e){values.textContent=e.message}};method.onchange=show;box.append(values);show();let controls=document.createElement('div');controls.className='rowtools';for(let [slot,label] of [['initial','Cargar inicial'],['control','Cargar control']]){let b=document.createElement('button');b.textContent=label;b.onclick=()=>{try{if(!m.unit)throw Error('La API no identificó la unidad. No se importa por suposición.');let v=aggregate(m,method.value);if(!Object.keys(v).length)throw Error('No hay valores numéricos para importar.');importMetric(m,v,slot,name.value,method.value,d,selectedPatient,t);msg('Resultado cargado como '+(slot==='initial'?'inicial':'control')+'. Revisa la fila importada y define su meta.')}catch(e){msg(e.message)}};controls.append(b)}box.append(controls);$('apiMetrics').append(box)}msg(d.note||'Revisa las métricas antes de cargar.')}
function importMetric(m,v,slot,label,method,response,patient,test){let date=response.date?new Date(response.date):null;let dateString=date&&!isNaN(date)?date.toLocaleDateString('es-CL',{timeZone:'America/Santiago'}):prompt('Confirma la fecha de esta evaluación (dd/mm/aaaa):');if(!dateString)throw Error('No se importó: falta fecha.');if(v.value!==undefined&&(v.left!==undefined||v.right!==undefined))throw Error('La métrica mezcla resultados globales y por lado. Usa el ingreso manual para elegir el dato correcto.');const single=v.value!==undefined&&v.left===undefined&&v.right===undefined;let key=m.fingerprint?[patient.source,patient.id,m.fingerprint,method,single?'single':'sides'].join('|'):null;let r=key?data.rows.find(x=>x.importKey===key):null;if(r&&r[slot==='initial'?'controlTest':'initialTest']===response.test)throw Error('Esta misma evaluación ya está cargada en la otra columna. Elige una evaluación distinta para comparar evolución.');if(!r){r={group:m.group||'force',format:single?'single':'sides',name:label,unit:m.unit,protocol:(patient.source==='vald'?(test.source==='fd'?'VALD ForceDecks':'VALD DynaMo'):'Kinvent')+' · '+m.protocol+' · '+(method==='max'?'máximo':method==='mean'?'media':m.method),initial:'',current:'',li:'',ri:'',lc:'',rc:'',metric:single?'current':data.side==='left'?'lc':'rc',op:'>=',goal:'',mode:'auto',direction:'review',importKey:key,origin:'',reviewed:false,kpi:m.kpi||''};data.rows.push(r)}
const keys=slot==='initial'?['li','ri','initial']:['lc','rc','current'];if(keys.some(k=>number(r[k])!==null)&&!confirm('Ya hay datos en esta columna para el mismo KPI y protocolo. ¿Reemplazarlos?'))return;
for(const k of keys)r[k]='';
if(v.left!==undefined)r[keys[0]]=v.left;if(v.right!==undefined)r[keys[1]]=v.right;if(v.value!==undefined)r[keys[2]]=v.value;r[slot==='initial'?'initialDate':'controlDate']=dateString;r[slot==='initial'?'initialTest':'controlTest']=response.test;r.origin='Paciente '+patient.name+' · Inicial: '+(r.initialTest||'sin cargar')+' · Control: '+(r.controlTest||'sin cargar');r.reviewed=false;if(slot==='initial')data.initialDate=dateString;else data.controlDate=dateString;editors();report();}
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
