@echo off
rem Abre el Lyric Render en el navegador con el servidor de desarrollo.
cd /d "%~dp0"

set URL=http://localhost:8000/lyric-render-9-16/

echo.
echo   Lyric Render - %URL%
echo   (Ctrl+C para detener el servidor)
echo.

start "" "%URL%"

where npm >nul 2>nul
if %errorlevel%==0 (
    npm run dev
    goto :eof
)

echo Necesitas Node + npm instalados (https://nodejs.org)
pause
