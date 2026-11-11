"""Detecta una organización en las regiones oficiales VALD. Solo consultas de lectura."""
import getpass
import json
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

AUTH_URL = 'https://auth.prd.vald.com/oauth/token'
REGIONS = {
    'aue': 'https://prd-aue-api-externaltenants.valdperformance.com/tenants',
    'use': 'https://prd-use-api-externaltenants.valdperformance.com/tenants',
    'euw': 'https://prd-euw-api-externaltenants.valdperformance.com/tenants',
}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(url, headers, body=None):
    req = urllib.request.Request(url, data=body, headers=headers,
                                 method='GET' if body is None else 'POST')
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(req, timeout=20) as response:
        raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise ValueError('Respuesta demasiado grande')
        return json.loads(raw)


def authenticate(client_id, client_secret):
    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': client_id,
        'client_secret': client_secret,
        'audience': 'vald-api-external',
    }).encode('utf-8')
    data = request_json(AUTH_URL, {'Content-Type': 'application/x-www-form-urlencoded'}, body)
    token = data.get('access_token') if isinstance(data, dict) else None
    if not isinstance(token, str) or not token:
        raise ValueError('No se recibió un token válido')
    return token


def tenant_list(data):
    if isinstance(data, list):
        return data
    # Acepta envoltorios habituales, sin adivinar la identidad de una organización.
    if isinstance(data, dict):
        for key in ('tenants', 'items', 'data'):
            if isinstance(data.get(key), list):
                return data[key]
    raise ValueError('Formato de respuesta no reconocido')


def check_region(region, token, tenant_id):
    try:
        data = request_json(REGIONS[region], {'Authorization': 'Bearer ' + token,
                                             'Accept': 'application/json'})
        tenants = tenant_list(data)
        found = any(isinstance(t, dict) and str(t.get('id', '')).lower() == tenant_id.lower()
                    for t in tenants)
        return region, 'found' if found else 'absent'
    except urllib.error.HTTPError as error:
        return region, 'HTTP ' + str(error.code)
    except (urllib.error.URLError, TimeoutError, OSError):
        return region, 'sin conexión o tiempo agotado'
    except (ValueError, TypeError):
        return region, 'respuesta no reconocida'


def detect(token, tenant_id):
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda region: check_region(region, token, tenant_id), REGIONS))
    found = [region for region, status in results if status == 'found']
    return found, results


def main():
    print('COMPROBACIÓN DE REGIÓN VALD - SBS')
    print('No guarda claves ni consulta fichas de pacientes.')
    print('Pega cada dato de la ficha compartida por VALD y pulsa Enter.\n')
    client_id = input('clientID: ').strip()
    tenant_id = input('HUB GUID / TEAM ID: ').strip()
    client_secret = getpass.getpass('clientSecret (oculto; no se ven caracteres al pegar): ').strip()
    if not all((client_id, tenant_id, client_secret)):
        print('\nFalta algún dato. Ejecuta la herramienta nuevamente.')
        return 1
    try:
        import uuid
        tenant_id = str(uuid.UUID(tenant_id))
    except ValueError:
        print('\nEl HUB GUID / TEAM ID debe ser un identificador UUID. Revisa lo copiado.')
        return 1
    print('\nVerificando autenticación…')
    try:
        token = authenticate(client_id, client_secret)
    except urllib.error.HTTPError as error:
        print('No se pudo autenticar: HTTP ' + str(error.code) + '. Revisa las credenciales y el acceso API.')
        return 1
    except Exception:
        print('No se pudo autenticar. Comprueba internet y vuelve a intentarlo.')
        return 1
    finally:
        client_secret = ''
    print('Autenticación correcta. Consultando las tres regiones…')
    found, results = detect(token, tenant_id)
    token = ''
    for region, status in results:
        print('  ' + region + ': ' + {'found': 'SBS encontrada', 'absent': 'la organización no figura'}.get(status, status))
    if len(found) == 1:
        print('\nRESULTADO PARA COMPARTIR: región ' + found[0])
        print('Este resultado identifica la región; no prueba todavía el acceso a ForceDecks o DynaMo.')
        return 0
    if len(found) > 1:
        print('\nLa organización aparece en más de una región. Comparte solo los códigos encontrados: ' + ', '.join(found))
    else:
        print('\nNo se pudo identificar la región. Comparte solo los estados de arriba, sin las claves.')
        print('Una región sin acceso o con error no demuestra que SBS no esté alojada allí.')
    return 1

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (KeyboardInterrupt, EOFError):
        print('\nOperación cancelada.')
        raise SystemExit(1)
