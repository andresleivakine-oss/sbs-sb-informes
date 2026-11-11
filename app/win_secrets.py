"""Almacenamiento DPAPI por usuario Windows; nunca guarda secretos en claro."""
import ctypes,json,os,tempfile
from pathlib import Path

def supported():return os.name=='nt'
def storage_path():
 if not supported() or not os.environ.get('LOCALAPPDATA'):raise RuntimeError('El guardado protegido requiere Windows. Usa solo esta sesión.')
 return Path(os.environ['LOCALAPPDATA'])/'SBS_SB'/'conexiones.dpapi'
def _crypt(data,decrypt=False):
 if not supported():raise RuntimeError('DPAPI solo está disponible en Windows.')
 from ctypes import wintypes
 class Blob(ctypes.Structure):_fields_=[('cbData',wintypes.DWORD),('pbData',ctypes.POINTER(ctypes.c_ubyte))]
 buf=ctypes.create_string_buffer(data);src=Blob(len(data),ctypes.cast(buf,ctypes.POINTER(ctypes.c_ubyte)));dst=Blob()
 dll=ctypes.WinDLL('crypt32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
 fn=dll.CryptUnprotectData if decrypt else dll.CryptProtectData
 fn.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)];fn.restype=wintypes.BOOL
 kernel.LocalFree.argtypes=[ctypes.c_void_p];kernel.LocalFree.restype=ctypes.c_void_p
 if not fn(ctypes.byref(src),None,None,None,None,1,ctypes.byref(dst)):raise RuntimeError('Windows no pudo proteger o recuperar la configuración.')
 try:return ctypes.string_at(dst.pbData,dst.cbData)
 finally:kernel.LocalFree(ctypes.cast(dst.pbData,ctypes.c_void_p))
def load():
 p=storage_path()
 if not p.exists():return {}
 x=json.loads(_crypt(p.read_bytes(),True).decode('utf-8'))
 if not isinstance(x,dict):raise RuntimeError('Configuración protegida no reconocida.')
 return x

def save(settings):
 p=storage_path();blob=_crypt(json.dumps(settings).encode('utf-8'));p.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='conexiones-',suffix='.tmp',dir=p.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(blob)
  os.replace(tmp,p)
 finally:
  Path(tmp).unlink(missing_ok=True)
