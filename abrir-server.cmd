@echo off
rem Sirve la versión compilada (dist/) del Lyric Render en el navegador.
cd /d "%~dp0dist"

if not exist index.html (
    echo No hay build. Ejecuta primero: npm run build
    pause
    exit /b 1
)

set PORT=8000

echo.
echo   Lyric Render - http://localhost:%PORT%
echo   (Ctrl+C para detener el servidor)
echo.

start "" "http://localhost:%PORT%"

where uv >nul 2>nul
if %errorlevel%==0 (
    uv run --no-project python -m http.server %PORT%
    goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
    py -m http.server %PORT%
    goto :eof
)

python -m http.server %PORT%
