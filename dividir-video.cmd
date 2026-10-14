@echo off
rem Arrastra un video encima de este .cmd para dividirlo en partes de 90s.
rem (opcional: segundo argumento = segundos por parte, ej. 60)
if "%~1"=="" (
    echo Uso: arrastra un archivo de video encima de dividir-video.cmd
    pause
    exit /b 1
)
set SECS=%~2
if "%SECS%"=="" set SECS=90
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dividir-video.ps1" -Input "%~1" -Seconds %SECS%
pause
