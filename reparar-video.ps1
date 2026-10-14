# reparar-video.ps1
# Re-encodea un video (típicamente el .webm que graba el navegador con
# MediaRecorder) a un MP4 H.264 bien formado, en buena calidad, sin importar
# el tamaño. Repara timestamps/índices rotos que hacen que algunos players
# lo reproduzcan raro.
#
# Uso:
#   powershell -File reparar-video.ps1 -Input "video.webm"
#   powershell -File reparar-video.ps1 -Input "video.webm" -Quality 20 -Duration 10
#
# -Quality: menor = mejor calidad (16-20 recomendado). Default 17.
# -Duration: opcional, segundos a procesar (0 = todo, útil para pruebas).

param(
    [Parameter(Mandatory = $true)][Alias("Input")][string]$Src,
    [string]$Output = "",
    [int]$Quality = 17,
    [double]$Duration = 0
)

if (-not (Test-Path $Src)) {
    Write-Error "No existe el archivo: $Src"
    exit 1
}

if ($Output -eq "") {
    $base = [System.IO.Path]::GetDirectoryName($Src)
    $name = [System.IO.Path]::GetFileNameWithoutExtension($Src)
    $Output = Join-Path $base ($name + "_reparado.mp4")
}

# Filtros: fps constante a 60 (arregla el VFR/timestamps rotos de MediaRecorder),
# yuv420p + sar 1:1 para máxima compatibilidad de players.
$vf = "fps=60,format=yuv420p,setsar=1"

$durArgs = @()
if ($Duration -gt 0) { $durArgs = @("-t", "$Duration") }

# Encoders en orden de preferencia: hardware Intel QSV primero, CPU x264 de respaldo.
$attempts = @(
    @{
        Name = "h264_qsv (Intel Quick Sync - hardware)"
        Args = @("-c:v", "h264_qsv", "-preset", "veryslow", "-global_quality", "$Quality")
    },
    @{
        Name = "libx264 (CPU - respaldo)"
        Args = @("-c:v", "libx264", "-preset", "slow", "-crf", "$Quality", "-profile:v", "high")
    }
)

$ok = $false
foreach ($attempt in $attempts) {
    Write-Host ""
    Write-Host ">>> Intentando con $($attempt.Name) ..." -ForegroundColor Cyan

    $ffArgs = @(
        "-y", "-hide_banner", "-loglevel", "warning", "-stats",
        "-fflags", "+genpts",
        "-i", $Src
    ) + $durArgs + @(
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", $vf
    ) + $attempt.Args + @(
        "-c:a", "aac", "-b:a", "192k", "-ac", "2",
        "-movflags", "+faststart",
        "-shortest", $Output
    )

    & ffmpeg @ffArgs
    if ($LASTEXITCODE -eq 0 -and (Test-Path $Output)) {
        $ok = $true
        Write-Host ">>> OK con $($attempt.Name)" -ForegroundColor Green
        break
    }
    Write-Host ">>> Falló $($attempt.Name), probando siguiente..." -ForegroundColor Yellow
    Remove-Item $Output -Force -ErrorAction SilentlyContinue
}

if (-not $ok) {
    Write-Error "Ningún encoder funcionó."
    exit 1
}

$item = Get-Item $Output
Write-Host ""
Write-Host "Listo:" -ForegroundColor Green
Write-Host "  $($item.FullName)"
Write-Host ("  {0:N1} MB" -f ($item.Length / 1MB))
