@echo off
rem Sauvegarde quotidienne de gestion-stock vers la cle USB (lecteur F:).
rem Lancee par la tache planifiee "GestionStock - Sauvegarde quotidienne".
rem Si la cle n'est pas branchee, sauvegarde.js bascule sur sauvegardes-locales\.
setlocal
cd /d "%~dp0.."
if not exist "sauvegardes-locales" mkdir "sauvegardes-locales"
node "scripts\sauvegarde.js" --vers "F:\gestion-stock" --garder 10 >> "sauvegardes-locales\sauvegarde-quotidienne.log" 2>&1
exit /b %ERRORLEVEL%
