# dividir-video.ps1
# Divide un video en partes de N segundos (default 90), con cortes EXACTOS:
# sin huecos entre partes y sin frames repetidos. Cada parte es un MP4
# independiente, bien encodado (H.264 + AAC), que empieza en el frame exacto
# donde terminó la anterior.
#
# Cómo lo logra: la fuente se normaliza a 60 fps constantes (90 s = 5400
# frames exactos) y cada parte se extrae con seek preciso (-ss/-t) y
# re-encode propio, así el primer frame de la parte i+1 es el frame
# inmediatamente siguiente al último de la parte i.
#
# Uso:
#   powershell -File dividir-video.ps1 -Input "video.mp4"
#   powershell -File dividir-video.ps1 -Input "video.mp4" -Seconds 60 -Quality 18

param(
    [Parameter(Mandatory = $true)][Alias("Input")][string]$Src,
    [int]$Seconds = 90,
    [int]$Quality = 17,
    [string]$OutputDir = ""
)

if (-not (Test-Path $Src)) {
    Write-Error "No existe el archivo: $Src"
    exit 1
}

if ($Seconds -lt 1) {
    Write-Error "Seconds debe ser >= 1"
    exit 1
}

# Duración total de la fuente
$durationStr = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $Src
$totalDuration = [double]::Parse($durationStr, [System.Globalization.CultureInfo]::InvariantCulture)
$parts = [Math]::Ceiling($totalDuration / $Seconds)

$base = [System.IO.Path]::GetDirectoryName($Src)
$name = [System.IO.Path]::GetFileNameWithoutExtension($Src)
if ($OutputDir -eq "") {
    $OutputDir = Join-Path $base ($name + "_partes")
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

Write-Host ""
Write-Host "Fuente: $Src ($([Math]::Round($totalDuration, 1))s) -> $parts partes de ${Seconds}s" -ForegroundColor Cyan

# fps constante: hace que N segundos sean un número exacto de frames,
# así el corte cae justo en el borde de un frame (ni atrás ni repetido).
$vf = "fps=60,format=yuv420p,setsar=1"

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

# Elegir el primer encoder que funcione (prueba real con la parte 0)
$chosen = $null
foreach ($attempt in $attempts) {
    Write-Host ">>> Probando $($attempt.Name) ..." -ForegroundColor Cyan
    $testOut = Join-Path $OutputDir ($name + "_parte_00.mp4")
    $ffArgs = @(
        "-y", "-hide_banner", "-loglevel", "error",
        "-fflags", "+genpts",
        "-ss", "0", "-t", "$Seconds",
        "-i", $Src,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", $vf
    ) + $attempt.Args + @(
        "-c:a", "aac", "-b:a", "192k", "-ac", "2",
        "-movflags", "+faststart",
        $testOut
    )
    & ffmpeg @ffArgs
    if ($LASTEXITCODE -eq 0 -and (Test-Path $testOut)) {
        $chosen = $attempt
        Write-Host ">>> OK, se usará $($attempt.Name)" -ForegroundColor Green
        break
    }
    Write-Host ">>> Falló, probando siguiente..." -ForegroundColor Yellow
    Remove-Item $testOut -Force -ErrorAction SilentlyContinue
}

if (-not $chosen) {
    Write-Error "Ningún encoder funcionó."
    exit 1
}

# Generar las partes restantes (la 0 ya quedó hecha en la prueba)
for ($i = 1; $i -lt $parts; $i++) {
    $start = $i * $Seconds
    $outFile = Join-Path $OutputDir ($name + "_parte_{0:d2}.mp4" -f $i)
    Write-Host (">>> Parte $($i + 1)/${parts}: desde ${start}s ...")

    $ffArgs = @(
        "-y", "-hide_banner", "-loglevel", "error",
        "-fflags", "+genpts",
        "-ss", "$start", "-t", "$Seconds",
        "-i", $Src,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", $vf
    ) + $chosen.Args + @(
        "-c:a", "aac", "-b:a", "192k", "-ac", "2",
        "-movflags", "+faststart",
        $outFile
    )
    & ffmpeg @ffArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Falló la parte $i."
        exit 1
    }
}

Write-Host ""
Write-Host "Partes generadas en $OutputDir :" -ForegroundColor Green
Get-ChildItem $OutputDir -Filter *.mp4 | Sort-Object Name | ForEach-Object {
    Write-Host ("  {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB))
}
