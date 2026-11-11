"""Instalación por usuario y actualización desde un ZIP elegido localmente."""
import os,sys,shutil,tempfile,urllib.request,zipfile
from pathlib import Path
FILES=['index.html','connector.js','server.py','vald_common.py','win_secrets.py','test_labels.py','install_local.py','LEEME.txt','INICIAR.bat','INSTALAR.bat']

def running():
 try:
  with urllib.request.urlopen('http://127.0.0.1:8877/api/session',timeout=2) as r:return r.status==200
 except Exception:return False

def validate_zip(path):
 out={}
 with zipfile.ZipFile(path) as z:
  if len(z.infolist())>100 or sum(i.file_size for i in z.infolist())>5_000_000:raise ValueError('El ZIP supera el tamaño o número de archivos admitido.')
  for i in z.infolist():
   if i.is_dir():continue
   bits=i.filename.split('/')
   if len(bits)!=2 or bits[0]!='SBS_SB_Conectado' or bits[1] not in FILES or bits[1] in out:raise ValueError('Estructura de actualización no reconocida.')
   out[bits[1]]=z.read(i)
 if set(out)!=set(FILES):raise ValueError('Faltan archivos de la aplicación. Usa el paquete completo.')
 return out

VERSION='0.5.7'
UPDATE_ROOT='https://raw.githubusercontent.com/andresleivakine-oss/sbs-sb-informes/main/'

def version_tuple(value):
 import re
 if not isinstance(value,str) or not re.fullmatch(r'\d+\.\d+\.\d+',value):raise ValueError('Versión de actualización no válida.')
 return tuple(int(v) for v in value.split('.'))

def online_read(path,limit):
 import re
 if path!='updates/latest.json' and not re.fullmatch(r'updates/packages/[0-9a-f]{64}\.zip',path):raise ValueError('Ruta de actualización no permitida.')
 req=urllib.request.Request(UPDATE_ROOT+path,headers={'User-Agent':'SBS-SB-Updater/'+VERSION,'Cache-Control':'no-cache'})
 # Los archivos se publican en raw.githubusercontent.com; no se envían claves.
 class StrictRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args):raise ValueError('La fuente intentó redirigir la descarga.')
 with urllib.request.build_opener(StrictRedirect()).open(req,timeout=30) as r:
  data=r.read(limit+1)
  if len(data)>limit:raise ValueError('Actualización demasiado grande.')
  return data

def parse_manifest(raw):
 import json,re
 m=json.loads(raw)
 if not isinstance(m,dict) or m.get('schema')!=1:raise ValueError('Manifiesto de actualización no reconocido.')
 version_tuple(m.get('version'));digest=m.get('sha256','')
 if not isinstance(digest,str) or not re.fullmatch(r'[0-9a-f]{64}',digest):raise ValueError('Falta una huella SHA-256 válida.')
 if m.get('package')!='updates/packages/'+digest+'.zip':raise ValueError('El paquete no coincide con el manifiesto.')
 return m

def check_online_update():
 m=parse_manifest(online_read('updates/latest.json',16000))
 return {'current':VERSION,'latest':m['version'],'available':version_tuple(m['version'])>version_tuple(VERSION),'source':'andresleivakine-oss/sbs-sb-informes'}

def validate_package_version(payload,version):
 import ast
 tree=ast.parse(payload['install_local.py'].decode('utf-8'))
 actual=None
 for node in tree.body:
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='VERSION' for t in node.targets):actual=ast.literal_eval(node.value)
 if actual!=version:raise ValueError('La versión del paquete no coincide con el manifiesto.')
 for name,content in payload.items():
  if name.endswith('.py'):ast.parse(content.decode('utf-8'),filename=name)

def stage_online_update():
 import hashlib,subprocess
 if os.name!='nt':raise RuntimeError('La instalación automática requiere Windows.')
 m=parse_manifest(online_read('updates/latest.json',16000))
 if version_tuple(m['version'])<=version_tuple(VERSION):raise ValueError('No hay una versión nueva para instalar.')
 data=online_read(m['package'],5_000_000)
 if hashlib.sha256(data).hexdigest()!=m['sha256']:raise ValueError('La descarga no supera la comprobación SHA-256. No se ha instalado.')
 base=Path(os.environ['LOCALAPPDATA'])/'SBS_SB';stage=base/'update-pending';stage.mkdir(parents=True,exist_ok=True)
 archive=stage/'package.zip';archive.write_bytes(data)
 payload=validate_zip(archive);validate_package_version(payload,m['version'])
 # El código que aplica el cambio es el actualizador de la versión instalada.
 helper=stage/'apply_update.py';shutil.copyfile(Path(__file__).resolve(),helper)
 subprocess.Popen([sys.executable,str(helper),'--apply-staged',str(archive),m['sha256'],m['version']],cwd=str(stage),creationflags=getattr(subprocess,'CREATE_NEW_CONSOLE',0))
 return {'message':'Descarga verificada. La aplicación se cerrará y volverá a abrirse al terminar.','version':m['version']}

def install_payload(payload):
 if os.name!='nt':raise RuntimeError('La instalación requiere Windows.')
 base=Path(os.environ['LOCALAPPDATA'])/'SBS_SB';target=base/'app';base.mkdir(parents=True,exist_ok=True)
 if running():raise RuntimeError('La aplicación sigue abierta. No se ha modificado.')
 stage=Path(tempfile.mkdtemp(prefix='app-next-',dir=base));backup=base/'app-anterior'
 try:
  for n,b in payload.items():(stage/n).write_bytes(b)
  if backup.exists():shutil.rmtree(backup)
  if target.exists():target.rename(backup)
  try:stage.rename(target)
  except Exception:
   if backup.exists():backup.rename(target)
   raise
 finally:
  if stage.exists():shutil.rmtree(stage)
 launcher='@echo off\nchcp 65001 >nul\ncd /d "'+str(target)+'"\npy -3 server.py\nif errorlevel 1 pause\n'
 updater='@echo off\nchcp 65001 >nul\npy -3 "'+str(target/'install_local.py')+'" --update\npause\n'
 (base/'Abrir SBS SB.cmd').write_text(launcher,encoding='utf-8');(base/'Actualizar SBS SB.cmd').write_text(updater,encoding='utf-8')
 # Accesos en el menú Inicio; no presupone la ubicación del escritorio/OneDrive.
 menu=Path(os.environ['APPDATA'])/'Microsoft'/'Windows'/'Start Menu'/'Programs'/'SBS SB';menu.mkdir(parents=True,exist_ok=True)
 (menu/'Abrir SBS SB.cmd').write_text(launcher,encoding='utf-8');(menu/'Actualizar SBS SB.cmd').write_text(updater,encoding='utf-8')
 print('Instalado. Busca Abrir SBS SB en el menú Inicio. Las conexiones protegidas se conservan al actualizar.')
 print('Las siguientes versiones se descargan desde Actualizar aplicación, dentro de la pantalla.')
 os.startfile(str(base/'Abrir SBS SB.cmd'))

def main():
 if os.name!='nt':raise RuntimeError('Esta instalación es para Windows.')
 if '--apply-staged' in sys.argv:
  import hashlib,time,re
  _,mode,path,digest,version=sys.argv
  version_tuple(version)
  if not re.fullmatch(r'[0-9a-f]{64}',digest):raise ValueError('Huella inválida.')
  archive=Path(path);data=archive.read_bytes()
  if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('La actualización cambió después de verificarla.')
  payload=validate_zip(archive);validate_package_version(payload,version)
  for _ in range(100):
   if not running():break
   time.sleep(.3)
  if running():raise RuntimeError('La aplicación no se cerró. Puedes seguir usando la versión anterior.')
  install_payload(payload);return
 if '--update' in sys.argv:
  from tkinter import Tk,filedialog
  root=Tk();root.withdraw();chosen=filedialog.askopenfilename(title='Selecciona un ZIP SBS / SB confiable (actualización manual de respaldo)',filetypes=[('Paquete SBS / SB','*.zip')]);root.destroy()
  if not chosen:return
  if input('Escribe ACTUALIZAR para instalar el paquete seleccionado: ').strip()!='ACTUALIZAR':return
  payload=validate_zip(chosen)
 else:
  src=Path(__file__).resolve().parent;payload={n:(src/n).read_bytes() for n in FILES}
 if running():
  print('Cierra la consola anterior con Ctrl+C antes de instalar.')
  input('Cuando esté cerrada, presiona Enter: ')
 install_payload(payload)
if __name__=='__main__':
 try:main()
 except Exception as e:print('No se completó la actualización: '+str(e));input('Presiona Enter para cerrar.');sys.exit(1)
