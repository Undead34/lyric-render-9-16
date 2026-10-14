@echo off
rem Arrastra un video encima de este .cmd para repararlo/re-encodearlo a MP4.
if "%~1"=="" (
    echo Uso: arrastra un archivo de video encima de reparar-video.cmd
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reparar-video.ps1" -Input "%~1"
pause
