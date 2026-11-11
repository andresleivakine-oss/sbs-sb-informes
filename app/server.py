"""Aplicación local de lectura VALD y Kinvent. No modifica datos del proveedor."""
import getpass,json,os,secrets,time,threading,urllib.request,urllib.error,urllib.parse,uuid,webbrowser,unicodedata,hashlib
from pathlib import Path
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from vald_common import authenticate,NoRedirect
import tempfile,base64
import win_secrets
from test_labels import friendly,decorate
from install_local import VERSION,check_online_update,stage_online_update
ROOT=Path(__file__).resolve().parent
PORT=8877
SESSION=secrets.token_urlsafe(32)
CID=SECRET=KINVENT=''
TENANT=''
TOKEN='';TOKEN_TIME=0
API_LOCK=threading.RLock();VERIFIED={'vald':False,'kinvent':False};SAVED={};STORAGE_WARNING='';
LOCK=threading.Lock();CACHE={};TESTS={};HISTORY={}
VBASE={'profiles':'https://prd-use-api-externalprofile.valdperformance.com','fd':'https://prd-use-api-extforcedecks.valdperformance.com','dyn':'https://prd-use-api-extdynamo.valdperformance.com'}
class UserError(Exception):pass

def fetch(url,headers,body=None):
 req=urllib.request.Request(url,data=None if body is None else json.dumps(body).encode(),headers=headers,method='GET' if body is None else 'POST')
 with urllib.request.build_opener(NoRedirect()).open(req,timeout=45) as r:
  if r.status==204:return None
  raw=r.read(15_000_001)
  if len(raw)>15_000_000:raise UserError('La respuesta es demasiado grande. Acota el intervalo de fechas.')
  return json.loads(raw)

def vald(url):
 global TOKEN,TOKEN_TIME
 if not CID or not SECRET:raise UserError('VALD no configurado. Abre Conexiones y configura sus credenciales.')
 with LOCK:
  if not TOKEN or time.monotonic()-TOKEN_TIME>300:
   TOKEN=authenticate(CID,SECRET);TOKEN_TIME=time.monotonic()
 try:return fetch(url,{'Authorization':'Bearer '+TOKEN,'Accept':'application/json'})
 except urllib.error.HTTPError as e:
  if e.code==401:
   with LOCK:TOKEN=''
  raise

def kin(path,body=None):
 if not KINVENT:raise UserError('Kinvent no configurado. Abre Conexiones e introduce su clave.')
 return fetch('https://api.k-invent.com'+path,{'X-Api-Key':KINVENT,'Content-Type':'application/json','Accept':'application/json'},body)

def coll(x,keys):
 if x is None:return []
 if isinstance(x,list):return x
 if isinstance(x,dict):
  for k in keys:
   if isinstance(x.get(k),list):return x[k]
 raise UserError('Estructura de respuesta no reconocida. No se ha interpretado como ausencia de datos.')
def normal(s):return ''.join(c for c in unicodedata.normalize('NFD',str(s).lower()) if not unicodedata.combining(c))
def ident(s):return str(uuid.UUID(str(s)))
def finite(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and __import__('math').isfinite(v)
def fingerprint(v):return hashlib.sha256(json.dumps(v,sort_keys=True,default=str).encode()).hexdigest()[:24]
def utc(s,end=False):
 try:d=datetime.strptime(s,'%Y-%m-%d')
 except (TypeError,ValueError):raise UserError('Selecciona fechas válidas.')
 if end:d+=__import__('datetime').timedelta(days=1)
 return d.strftime('%Y-%m-%dT00:00:00.000Z')

def birthdate(value):
 if value in [None,'',0]:return ''
 try:
  if isinstance(value,(int,float)) or str(value).lstrip('-').isdigit():
   x=float(value);d=datetime.fromtimestamp(x/1000 if abs(x)>1e11 else x,timezone.utc).date()
   return d.isoformat() if 1900<=d.year<=datetime.now(timezone.utc).year else ''
  return datetime.strptime(str(value)[:10],'%Y-%m-%d').date().isoformat()
 except (ValueError,OverflowError,OSError):return ''

def identity_path():
 root=Path(os.environ.get('LOCALAPPDATA') or Path.home()/'.local'/'share')
 return root/'SBS_SB'/'identidad.json'
def read_identity():
 try:
  p=identity_path()
  if not p.exists():return {'brands':{}}
  value=json.loads(p.read_text(encoding='utf-8'))
  return {'brands':value} if isinstance(value,dict) else {'brands':{}}
 except Exception:raise UserError('No se pudo leer la identidad guardada.')
def save_identity(d):
 brands=d.get('brands')
 if not isinstance(brands,dict):raise UserError('Identidad no válida.')
 out={}
 for center in ['SBS','SB']:
  b=brands.get(center)
  if not isinstance(b,dict):raise UserError('Faltan los datos de un centro.')
  out[center]={}
  for key,limit in [('name',200),('address',400),('contact',250),('whatsapp',60),('phone',60),('logo',2800000)]:
   v=b.get(key,'')
   if not isinstance(v,str) or len(v)>limit:raise UserError('Un campo de identidad tiene un formato o tamaño inválido.')
   if key=='logo' and v:
    if not v.startswith(('data:image/png;base64,','data:image/jpeg;base64,')):raise UserError('Logo no válido. Usa PNG o JPG.')
    try:binary=base64.b64decode(v.split(',',1)[1],validate=True)
    except Exception:raise UserError('Logo no válido.')
    if len(binary)>2000000 or not binary.startswith((b'\x89PNG\r\n\x1a\n',b'\xff\xd8\xff')):raise UserError('Logo no válido o demasiado grande.')
   out[center][key]=v
 p=identity_path();p.parent.mkdir(parents=True,exist_ok=True);fd,tmp=tempfile.mkstemp(dir=p.parent,prefix='identidad-',suffix='.tmp')
 try:
  with os.fdopen(fd,'w',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False)
  os.replace(tmp,p)
 finally:Path(tmp).unlink(missing_ok=True)
 return {'message':'Identidad guardada.'}

def connection_status():
 return {'vald':bool(CID and SECRET),'kinvent':bool(KINVENT),'verified':dict(VERIFIED),'saved':{k:bool(v) for k,v in SAVED.items()},'canRemember':win_secrets.supported(),'storageWarning':STORAGE_WARNING,'region':'use','version':VERSION}

def configure(d):
 global CID,SECRET,KINVENT,TENANT,TOKEN,TOKEN_TIME,SAVED,STORAGE_WARNING
 provider=d.get('provider')
 if provider not in ['vald','kinvent']:raise UserError('Proveedor inválido.')
 if d.get('forget'):
  kept={k:v for k,v in SAVED.items() if k!=provider}
  if provider in SAVED:
   try:win_secrets.save(kept)
   except Exception:raise UserError('No se pudo eliminar la conexión guardada. No se ha cambiado la sesión.')
  SAVED=kept
  if provider=='vald':CID=SECRET=TOKEN=''
  else:KINVENT=''
  VERIFIED[provider]=False;CACHE.clear();TESTS.clear()
  return {**connection_status(),'message':'Conexión eliminada de esta sesión y del guardado protegido.'}
 if provider=='vald':
  cid=str(d.get('clientId','')).strip();secret=str(d.get('clientSecret','')).strip();tenant=ident(d.get('tenant') or TENANT)
  if not cid or not secret:raise UserError('Faltan clientID o clientSecret VALD.')
  token=authenticate(cid,secret)
  coll(fetch(VBASE['profiles']+'/profiles?'+urllib.parse.urlencode({'tenantId':tenant}),{'Authorization':'Bearer '+token,'Accept':'application/json'}),['profiles','items'])
  candidate={'clientId':cid,'clientSecret':secret,'tenant':tenant}
 else:
  key=str(d.get('apiKey','')).strip()
  if not key:raise UserError('Falta la clave Kinvent.')
  probe=fetch('https://api.k-invent.com/api/participants/v2/paginated',{'X-Api-Key':key,'Accept':'application/json','Content-Type':'application/json'},{'isAthlete':False,'page':0,'query':'sbs-connection-check-'+uuid.uuid4().hex,'size':20,'tags':[]})
  coll(probe,['content','participants','items','data','results'])
  candidate={'apiKey':key}
 kept=dict(SAVED)
 if d.get('remember'):kept[provider]=candidate
 else:kept.pop(provider,None)
 if d.get('remember') or provider in SAVED:
  try:win_secrets.save(kept)
  except Exception:raise UserError('No se pudo guardar con protección Windows. Desmarca Recordar para usar solo esta sesión.')
 SAVED=kept;STORAGE_WARNING=''
 if provider=='vald':CID=cid;SECRET=secret;TENANT=tenant;TOKEN=token;TOKEN_TIME=time.monotonic()
 else:KINVENT=key
 VERIFIED[provider]=True;CACHE.clear();TESTS.clear()
 return {**connection_status(),'message':('VALD: autenticación y lectura de perfiles verificadas. Las pruebas se comprueban al consultarlas.' if provider=='vald' else 'Kinvent: búsqueda de perfiles verificada. Historial y métricas se comprueban al consultarlos.')+(' Conexión guardada con protección Windows.' if d.get('remember') else ' Conexión disponible solo durante esta sesión.')}

def profiles():
 if 'profiles' in CACHE and time.monotonic()-CACHE['profiles'][0]<600:return CACHE['profiles'][1]
 raw=coll(vald(VBASE['profiles']+'/profiles?'+urllib.parse.urlencode({'tenantId':TENANT})),['profiles','items'])
 out=[]
 for p in raw:
  if not isinstance(p,dict) or not p.get('profileId'):continue
  out.append({'id':p['profileId'],'name':' '.join(str(p.get(k) or '') for k in ['givenName','familyName']).strip(),'birth':str(p.get('dateOfBirth') or '')[:10],'source':'vald'})
 CACHE['profiles']=(time.monotonic(),out);return out

def search(d):
 q=str(d.get('query','')).strip()
 if len(q)<2:raise UserError('Escribe al menos dos letras del nombre.')
 if d.get('source')=='vald':
  ps=profiles();return {'patients':[p for p in ps if all(x in normal(p['name']) for x in normal(q).split())][:50]}
 raw=kin('/api/participants/v2/paginated',{'isAthlete':bool(d.get('athlete',False)),'page':max(0,int(d.get('page',0))),'query':q[:120],'size':20,'tags':[]})
 out=[]
 for p in coll(raw,['content','participants','items','data','results']):
  if not isinstance(p,dict):continue
  code=p.get('code') or p.get('participantCode');name=p.get('fullName') or ' '.join(str(p.get(k) or '') for k in ['firstName','lastName']).strip() or ' '.join(str(p.get(k) or '') for k in ['givenName','familyName']).strip() or p.get('name')
  if code and name:out.append({'id':code,'name':name,'birth':birthdate(p.get('dateOfBirth') or p.get('birthDate')),'source':'kinvent'})
 return {'patients':out,'page':max(0,int(d.get('page',0))),'note':'Búsqueda de 20 perfiles por página.'}

def list_tests(d):
 source=d.get('source');pid=ident(d.get('patient'));start=utc(d.get('start'));end=utc(d.get('end'),True)
 if start>=end:raise UserError('La fecha inicial debe ser anterior o igual a la final.')
 if source=='vald':
  if not any(p['id']==pid for p in profiles()):raise UserError('Selecciona un paciente de la búsqueda.')
  system=d.get('system');params={'tenantId':TENANT,'modifiedFromUtc':d.get('cursor') or start,'profileId':pid}
  if system=='fd':
   raw=coll(vald(VBASE['fd']+'/tests?'+urllib.parse.urlencode(params)),['tests']);cursor=max((str(t.get('modifiedDateUtc') or '') for t in raw),default='');more=bool(raw)
  elif system=='dyn':
   page=max(1,int(d.get('page',1)));obj=vald(VBASE['dyn']+'/v2022q2/teams/'+TENANT+'/tests?'+urllib.parse.urlencode({'modifiedFromUtc':start,'testFromUtc':start,'testToUtc':end,'athleteId':pid,'page':page}));raw=coll(obj,['items']);cursor='';more=bool(raw) and (not isinstance(obj,dict) or page<int(obj.get('totalPages',page+1)))
  else:raise UserError('Equipo inválido')
  out=[]
  for t in raw:
   if not isinstance(t,dict):continue
   id_=t.get('testId') or t.get('id');date=t.get('recordedDateUtc') or t.get('startTimeUTC') or '';profile=t.get('profileId') or t.get('athleteId')
   if profile and str(profile)!=pid:continue
   # Fechas se filtran también por realización, no solo modificación.
   if date and not start[:10]<=str(date)[:10]<end[:10]:continue
   if not id_:continue
   title=t.get('testType') if system=='fd' else ' · '.join(str(t.get(k) or '') for k in ['bodyRegion','movement','position'])
   key=source+':'+system+':'+str(id_);TESTS[key]={'raw':t,'patient':pid,'system':system,'date':date}
   out.append(decorate({'key':key,'title':title or 'Evaluación','date':str(date),'source':system},t))
  return {'tests':sorted(out,key=lambda t:t['date'],reverse=True),'cursor':cursor,'more':more,'page':int(d.get('page',1)),'note':'Usa Cargar más hasta completar el historial. La primera respuesta no es el total.'}
 raw=kin('/api/protocols/common/v1/findByParticipantCode?'+urllib.parse.urlencode({'participantCode':pid}),{})
 records=coll(raw,['protocols','items','data','content']);out=[];excluded=0
 for t in records:
  if not isinstance(t,dict):continue
  if t.get('deleted') or (t.get('participantCode') and str(t['participantCode'])!=pid):continue
  id_=t.get('code') or t.get('protocolCode');date=min((a.get('startTime') for a in t.get('activities',[]) if isinstance(a.get('startTime'),(int,float))),default=None) or ''
  if isinstance(date,(int,float)):date=datetime.fromtimestamp(date/1000 if date>1e11 else date,timezone.utc).isoformat()
  if not id_:continue
  if date and not start[:10]<=str(date)[:10]<end[:10]:
   excluded+=1;continue
  key='kinvent:'+str(id_);TESTS[key]={'raw':t,'patient':pid,'system':'kinvent','date':date}
  title=t.get('name') or t.get('title') or (t.get('config') or {}).get('title') or ' · '.join(str((a.get('config') or {}).get('title') or '') for a in t.get('activities',[])) or 'Evaluación Kinvent'
  out.append(decorate({'key':key,'title':title,'date':str(date),'source':'Kinvent'},t))
 return {'tests':sorted(out,key=lambda t:t['date'],reverse=True),'more':False,'received':len(records),'excluded':excluded,'note':'Kinvent: comprueba nombre y fecha antes de importar. Verifica resultados y unidades con el informe original antes de emitir.'}

def dynamo_metrics(t):
 category=t.get('testCategory');field='maxRangeOfMotionDegrees' if category=='RangeofMotion' else 'maxForceNewtons' if category=='Strength' else None
 if not field:return []
 sides={};unit='°' if category=='RangeofMotion' else 'N';group='rom' if category=='RangeofMotion' else 'force'
 for s in t.get('repetitionTypeSummaries',[]):
  v=s.get(field);side={'LeftSide':'left','RightSide':'right','BothSides':'value','None':'value'}.get(s.get('laterality'))
  if side and finite(v):sides[side]=v
 if not sides:return []
 protocol={k:t.get(k) for k in ['testCategory','bodyRegion','movement','position','customPosition','attachments','leftAttachment','rightAttachment']}
 name=' · '.join(str(t.get(k) or '') for k in ['bodyRegion','movement']).strip(' ·')
 return [{'id':field,'name':name,'unit':unit,'group':group,'values':sides,'method':'Máximo por lado · resúmenes DynaMo','protocol':' · '.join(str(t.get(k) or '') for k in ['position','customPosition']).strip(' ·'),'fingerprint':fingerprint(['DynaMo',protocol,field,unit]),'kpi':'Fuerza máxima en la posición evaluada.' if group=='force' else 'Amplitud de movimiento; conservar signo y posición del protocolo.'}]

def force_metrics(trials,meta):
 groups={}
 for tr in trials:
  for r in tr.get('results',[]):
   if not isinstance(r,dict) or not finite(r.get('value')):continue
   definition=r.get('definition') or {};key=str(r.get('resultId'));limb=str(r.get('limb') or tr.get('limb') or 'Trial')
   item=groups.setdefault(key,{'id':key,'name':definition.get('name') or definition.get('result') or 'KPI '+key,'unit':definition.get('unit') or '', 'samples':{},'group':'force','protocol':str(meta.get('testType') or ''),'kpi':''})
   item['samples'].setdefault(limb,[]).append(r['value'])
 config={k:meta.get(k) for k in ['testType','parameter','extendedParameters']}
 for x in groups.values():x['fingerprint']=fingerprint(['ForceDecks',config,x['id'],x['unit']]);x['method']='Seleccionar intento o máximo/media por lado';x['values']={}
 return list(groups.values())

def decode_results(obj,depth=0):
 if depth>20:raise UserError('El resultado tiene demasiados niveles de datos.')
 if isinstance(obj,str) and obj.lstrip().startswith(('{','[','"')):
  try:
   value=json.loads(obj)
   if value!=obj:return decode_results(value,depth+1)
  except (ValueError,TypeError):pass
 if isinstance(obj,dict):return {k:decode_results(v,depth+1) for k,v in obj.items() if k not in ['_forces','forces','_deltas','deltas','_syncedSamples','syncedSamples']}
 if isinstance(obj,list):return [decode_results(v,depth+1) for v in obj]
 return obj

def kin_metrics(result, raw=None):
 out=[];activities=(raw or {}).get('activities') or []
 def pick(o,*keys):
  for k in keys:
   if k in o:return o[k]
  return None
 def walk(o,path,activity=None):
  if isinstance(o,dict):
   code=o.get('activityCode')
   if code:
    activity=next((a for a in activities if a.get('code')==code),None) or {'code':code,'config':o.get('config') or {}}
   if activity is None:
    activity=next((a for a in activities if str(a.get('code','not-found')) in path),None)
    if activity is None and len(activities)==1:activity=activities[0]
   cfg=(activity or {}).get('config') or {}
   reps=pick(o,'_resultsPerRep','resultsPerRep','repResults') or []
   if not isinstance(reps,list):reps=[]
   reps=[r for r in reps if isinstance(r,dict) and not r.get('deleted')]
   devices={str(pick(r,'_device','device')) for r in reps if pick(r,'_device','device')}
   if not devices:
    devices={str(x.get('deviceType')) for x in cfg.get('activityConfigDevices',[]) if isinstance(x,dict) and x.get('deviceType') and not x.get('deleted')}
   unit='°' if devices=={'SENS'} else 'kgf' if devices and devices<={'KFORCE_GRIP','GRIP','LINK','BUBBLE'} else None
   aggregate=pick(o,'_maxPerSide','maxPerSide')
   values={};derived=False
   def put(side,v):
    k={'LEFT':'left','RIGHT':'right','BOTH':'value','NONE':'value'}.get(side)
    if k and finite(v):values[k]=v
   if unit:
    if isinstance(aggregate,list):
     for item in aggregate:
      if isinstance(item,dict):put(pick(item,'_key','key'),pick(item,'_value','value'))
    elif isinstance(aggregate,dict):
     for k,v in aggregate.items():put(k,v)
    if not values and reps:
     derived=True;by_side={}
     for rep in reps:
      side=pick(rep,'_repSide','repSide');value=pick(rep,'_maxValue','maxValue')
      if finite(value):by_side.setdefault(side,[]).append(value)
     for side,vs in by_side.items():put(side,max(vs))
    if values:
     protocol=friendly(cfg.get('title') or 'Prueba Kinvent')
     config=dict(cfg);config.pop('code',None)
     out.append({'id':path+'._maxPerSide','name':protocol,'unit':unit,'group':'rom' if unit=='°' else 'force','values':values,'method':'Máximo de picos por repetición y lado' if derived else 'Máximo por lado · resumen Kinvent','protocol':protocol+' · '+str(cfg.get('exerciseType') or ''),'fingerprint':fingerprint(['Kinvent',config,'_maxPerSide',unit]) if config else None,'kpi':'ROM: amplitud articular, según posición del protocolo.' if unit=='°' else 'Fuerza máxima: mayor fuerza registrada en el protocolo evaluado.'})
   for k,v in o.items():
    if k not in ['_resultsPerRep','resultsPerRep','repResults','_forces','forces','_deltas','deltas','_syncedSamples','syncedSamples']:walk(v,path+'.'+k,activity)
  elif isinstance(o,list):
   for i,v in enumerate(o):walk(v,path+'['+str(i)+']',activity)
 walk(decode_results(result),'actividad')
 return out

def metrics(d):
 key=d.get('key');entry=TESTS.get(key)
 if not entry or entry['patient']!=d.get('patient'):raise UserError('Selecciona una evaluación del paciente actual.')
 system=entry['system'];raw=entry['raw'];date=entry['date']
 if system=='dyn':
  t=vald(VBASE['dyn']+'/v2022q2/teams/'+TENANT+'/tests/'+ident(raw['id']));out=dynamo_metrics(t)
 elif system=='fd':
  trials=coll(vald(VBASE['fd']+'/v2019q3/teams/'+TENANT+'/tests/'+ident(raw['testId'])+'/trials'),['trials']);out=force_metrics(trials,raw)
 else:
  code=raw.get('code') or raw.get('protocolCode');resp=kin('/api/protocols/v2/analyze?detailed=false',[code]);out=[]
  for p in coll(resp,['protocolsResults']):
   parsed=decode_results(p.get('activitiesResults'))
   out.extend(kin_metrics(parsed,raw))
 return {'metrics':out,'date':date,'test':key,'note':('Métricas reconocidas; revisa etiqueta, método, unidad y posición antes de importar.' if out else 'No hay métricas reconocidas para importar automáticamente. Este tipo requiere adaptar el lector; usa ingreso manual mientras tanto.')}

class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def log_message(self,*a):pass
 def hostok(self):return self.headers.get('Host') in [f'127.0.0.1:{PORT}',f'localhost:{PORT}']
 def reply(self,status,obj):
  b=json.dumps(obj,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(b)
 def do_GET(self):
  if not self.hostok():return self.reply(403,{'error':'Host inválido'})
  if self.path=='/api/session':
   with API_LOCK:return self.reply(200,{'session':SESSION,**connection_status()})
  if self.path=='/api/identity':
   try:return self.reply(200,read_identity())
   except UserError as e:return self.reply(400,{'error':str(e)})
  if self.path not in ['/','/index.html','/connector.js']:return self.reply(404,{'error':'No disponible'})
  self.send_response(200);self.send_header('Content-Type','text/javascript; charset=utf-8' if self.path.endswith('.js') else 'text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write((ROOT/('connector.js' if self.path.endswith('.js') else 'index.html')).read_bytes())
 def do_POST(self):
  if not self.hostok() or self.headers.get('X-Session-Token')!=SESSION:return self.reply(403,{'error':'Sesión inválida. Recarga la aplicación.'})
  try:
   n=int(self.headers.get('Content-Length','0'))
   if not 0<=n<=(6000000 if self.path=='/api/identity' else 30000):raise UserError('Solicitud demasiado grande')
   d=json.loads(self.rfile.read(n) or '{}')
   if not isinstance(d,dict):raise UserError('Solicitud inválida.')
   with API_LOCK:
    if self.path=='/api/updates/check':out=check_online_update()
    elif self.path=='/api/updates/apply':out=stage_online_update()
    elif self.path=='/api/identity':out=save_identity(d)
    elif self.path=='/api/configure':out=configure(d)
    elif self.path=='/api/search':
     if d.get('refresh'):CACHE.clear()
     out=search(d)
    elif self.path=='/api/tests':out=list_tests(d)
    elif self.path=='/api/metrics':out=metrics(d)
    else:return self.reply(404,{'error':'Operación no habilitada'})
   self.reply(200,out)
   if self.path=='/api/updates/apply':threading.Timer(1,self.server.shutdown).start()
  except UserError as e:self.reply(400,{'error':str(e)})
  except urllib.error.HTTPError as e:self.reply(502,{'error':('Kinvent devolvió HTTP 401: puede deberse a permisos de esta operación, clave inválida o caducada. La búsqueda de pacientes no prueba el permiso de historial.' if (d.get('source') or d.get('provider') or str(d.get('key','')).split(':')[0])=='kinvent' and e.code==401 else 'El proveedor devolvió HTTP '+str(e.code)+'. Revisa configuración y permisos; la consulta puede repetirse.')})
  except (ValueError,TypeError,KeyError):self.reply(400,{'error':'Formato de solicitud o respuesta no reconocido. No se han importado datos.'})
  except Exception:self.reply(502,{'error':'No se pudo consultar. Revisa conexión e inténtalo nuevamente.'})

def main():
 global CID,SECRET,KINVENT,TENANT,TOKEN,SAVED,STORAGE_WARNING
 print('SBS / SB · Aplicación local 0.5.0 · Solo lectura.\nConfigura ambos proveedores desde Conexiones en la pantalla.\n')
 if win_secrets.supported():
  try:SAVED=win_secrets.load()
  except Exception:STORAGE_WARNING='No se pudo recuperar la configuración protegida. Vuelve a configurar las conexiones.'
 v=SAVED.get('vald') or {};k=SAVED.get('kinvent') or {}
 CID=os.environ.get('VALD_CLIENT_ID') or v.get('clientId','');SECRET=os.environ.get('VALD_CLIENT_SECRET') or v.get('clientSecret','')
 TENANT=os.environ.get('VALD_TENANT_ID') or v.get('tenant') or TENANT
 KINVENT=os.environ.get('KINVENT_API_KEY') or k.get('apiKey','')
 try:server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
 except OSError:
  print('No se pudo abrir el puerto 8877. Puede haber otra versión abierta. Cierra la consola anterior y vuelve a iniciar.');return
 print(f'Abre http://127.0.0.1:{PORT}. Mantén esta consola abierta. Ctrl+C para cerrar.')
 webbrowser.open(f'http://127.0.0.1:{PORT}')
 try:server.serve_forever()
 except KeyboardInterrupt:pass
 finally:server.server_close();SECRET=KINVENT=TOKEN=''
if __name__=='__main__':
 try:main()
 except (EOFError,KeyboardInterrupt):print('Cancelado.')
