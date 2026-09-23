# Llama a la cobranza diaria de Nodus (recordatorios, facturas del mes, SPEI,
# recargos, correos de aviso). Pensado para correr UNA vez al día desde el
# Programador de tareas de Windows en la PC/servidor donde corre la app.
# Lee CRON_SECRET del .env.local de la app, así el secreto no queda copiado.
$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $PSScriptRoot
$log = Join-Path $PSScriptRoot "cron-facturacion.log"
$puerto = 8080

try {
  $linea = Get-Content (Join-Path $app ".env.local") | Where-Object { $_ -match '^\s*CRON_SECRET\s*=' } | Select-Object -Last 1
  $secreto = ($linea -replace '^\s*CRON_SECRET\s*=\s*', '').Trim().Trim('"').Trim("'")
  if (-not $secreto) { throw "No se encontró CRON_SECRET en .env.local" }

  $r = Invoke-RestMethod -Method Post -Uri "http://localhost:$puerto/api/cron/facturacion-diaria" `
    -Headers @{ Authorization = "Bearer $secreto" } -TimeoutSec 300
  "$(Get-Date -Format s) OK $($r | ConvertTo-Json -Compress -Depth 5)" | Add-Content $log
} catch {
  "$(Get-Date -Format s) ERROR $($_.Exception.Message)" | Add-Content $log
  exit 1
}
