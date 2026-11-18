"""Almacenamiento DPAPI por usuario Windows; nunca guarda secretos en claro."""
import ctypes,json,os,tempfile,sys
from pathlib import Path

def supported():return os.name=='nt' or sys.platform=='darwin'
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
 if sys.platform=='darwin':return _mac_keychain()
 p=storage_path()
 if not p.exists():return {}
 x=json.loads(_crypt(p.read_bytes(),True).decode('utf-8'))
 if not isinstance(x,dict):raise RuntimeError('Configuración protegida no reconocida.')
 return x

def save(settings):
 if sys.platform=='darwin':_mac_keychain(settings);return
 p=storage_path();blob=_crypt(json.dumps(settings).encode('utf-8'));p.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='conexiones-',suffix='.tmp',dir=p.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(blob)
  os.replace(tmp,p)
 finally:
  Path(tmp).unlink(missing_ok=True)

def _mac_keychain(settings=None):
 """Generic password in the current user's macOS login Keychain."""
 from ctypes.util import find_library
 lib=ctypes.CDLL(find_library('Security'))
 ptr=ctypes.c_void_p;uint=ctypes.c_uint32
 service=b'cl.sbs-sb.informes';account=b'api-connections'
 lib.SecKeychainFindGenericPassword.argtypes=[ptr,uint,ctypes.c_char_p,uint,ctypes.c_char_p,ctypes.POINTER(uint),ctypes.POINTER(ptr),ctypes.POINTER(ptr)]
 lib.SecKeychainFindGenericPassword.restype=ctypes.c_int32
 lib.SecKeychainItemFreeContent.argtypes=[ptr,ptr]
 lib.SecKeychainItemModifyAttributesAndData.argtypes=[ptr,ptr,uint,ctypes.c_char_p]
 lib.SecKeychainItemModifyAttributesAndData.restype=ctypes.c_int32
 lib.SecKeychainAddGenericPassword.argtypes=[ptr,uint,ctypes.c_char_p,uint,ctypes.c_char_p,uint,ctypes.c_char_p,ptr]
 lib.SecKeychainAddGenericPassword.restype=ctypes.c_int32
 cf=ctypes.CDLL(find_library('CoreFoundation'));cf.CFRelease.argtypes=[ptr]
 length=uint();data=ptr();item=ptr()
 status=lib.SecKeychainFindGenericPassword(None,len(service),service,len(account),account,ctypes.byref(length),ctypes.byref(data),ctypes.byref(item))
 try:
  if status not in (0,-25300):raise RuntimeError('macOS no permitió acceder al Llavero.')
  if settings is None:
   value={} if status==-25300 else json.loads(ctypes.string_at(data,length.value).decode('utf-8'))
   if not isinstance(value,dict):raise RuntimeError('Conexiones no reconocidas.')
   return value
  blob=json.dumps(settings).encode('utf-8')
  result=lib.SecKeychainItemModifyAttributesAndData(item,None,len(blob),blob) if status==0 else lib.SecKeychainAddGenericPassword(None,len(service),service,len(account),account,len(blob),blob,None)
  if result:raise RuntimeError('macOS no pudo guardar las conexiones en el Llavero.')
 finally:
  if data.value:lib.SecKeychainItemFreeContent(None,data)
  if item.value:cf.CFRelease(item)
