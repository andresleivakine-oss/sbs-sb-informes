#!/bin/bash
cd "$(dirname "$0")/SBS_SB_Conectado" || exit 1
for candidate in /Library/Frameworks/Python.framework/Versions/Current/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
 if [ -x "$candidate" ] && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3,10))'; then
  "$candidate" install_local.py
  exit $?
 fi
done
printf 'Instala Python 3.10 o posterior desde python.org/downloads/macos/ y ejecuta Install Certificates.command. Luego vuelve a abrir este instalador.\n'
open https://www.python.org/downloads/macos/
read -r -p 'Pulsa Enter para cerrar.'
