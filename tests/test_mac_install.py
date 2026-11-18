import sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
import install_local as app
class MacInstall(unittest.TestCase):
 def test_install_retains_identity_and_creates_quoted_launcher(self):
  with tempfile.TemporaryDirectory(prefix='Mac user ') as home:
   home=Path(home);(home/'Desktop').mkdir()
   with patch.object(sys,'platform','darwin'),patch.object(Path,'home',return_value=home),patch.object(app,'running',return_value=False),patch('subprocess.Popen') as launch:
    base=app.app_base();base.mkdir(parents=True);(base/'identidad.json').write_text('retained')
    payload={n:(Path(__file__).resolve().parents[1]/'app'/n).read_bytes() for n in app.FILES}
    app.install_payload(payload)
    self.assertEqual((base/'identidad.json').read_text(),'retained')
    self.assertTrue((base/'app/server.py').is_file())
    shortcut=home/'Desktop/Informes SBS SB.command'
    self.assertTrue(shortcut.stat().st_mode & 0o100)
    self.assertIn("'",shortcut.read_text())
    self.assertEqual(launch.call_args.args[0][0],'/usr/bin/open')
    app.install_payload(payload)
    self.assertTrue((base/'app-anterior/server.py').exists())
if __name__=='__main__':unittest.main()
