# Hourly runner for the book pipeline (Windows Task Scheduler: SisyphusLibraryPipeline).
# One run = one wave (see PIPELINE.md, RUNBOOK). Exits at once when paused, already running,
# or finished. When the usage limit is hit, claude exits and the next hourly run resumes from disk.
$ErrorActionPreference = 'Continue'
$lib = Split-Path -Parent $PSScriptRoot
Set-Location $lib
$env:PYTHONIOENCODING = 'utf-8'
New-Item -ItemType Directory -Force logs | Out-Null
$summary = Join-Path $lib 'logs\pipeline.log'
function Note($msg) { Add-Content -Path $summary -Encoding utf8 -Value ("{0:yyyy-MM-dd HH:mm}  {1}" -f (Get-Date), $msg) }

if (Test-Path 'PAUSE') { exit 0 }

$lock = Join-Path $lib '.pipeline.lock'
if (Test-Path $lock) {
    $old = Get-Content $lock -ErrorAction SilentlyContinue
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { exit 0 }
}
Set-Content -Path $lock -Value $PID

try {
    git fetch -q origin 2>$null
    $next = & python tools/pipeline.py next
    if (-not $next) { Note 'all books deployed - nothing to do'; exit 0 }

    $log = Join-Path $lib ("logs\run-{0:yyyyMMdd-HHmm}.log" -f (Get-Date))
    Note ("start wave: " + (($next | ForEach-Object { ($_ -split "`t")[0] }) -join ', '))
    $prompt = 'Run one wave of the Sisyphus Library book pipeline. Read PIPELINE.md and follow its RUNBOOK section exactly, then stop.'
    & "$env:USERPROFILE\.local\bin\claude.exe" -p $prompt --model sonnet --permission-mode acceptEdits *> $log
    $code = $LASTEXITCODE
    $tail = (Get-Content $log -Tail 3 -ErrorAction SilentlyContinue) -join ' '
    if ($tail -match 'limit|usage|quota|credit') { Note "stopped: usage limit ($tail)" }
    else { Note "finished (exit $code): $tail" }
}
finally {
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
