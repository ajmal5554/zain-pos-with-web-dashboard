$ErrorActionPreference = 'Stop'
$repairRoot = Split-Path -Parent $PSScriptRoot
$repairLog = Join-Path $repairRoot 'backups\printer-repair-result.txt'
Start-Transcript -Path $repairLog -Force
try {
    $repairBackup = Join-Path $repairRoot ('backups\printer-repair-admin-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $repairSource = 'C:\Windows\System32\DriverStore\FileRepository\ntprint.inf_amd64_7ec90cac1a11fca1\Amd64'
    $repairTarget = 'C:\Windows\System32\spool\drivers\x64\3'
    $repairNames = @('UNIDRV.DLL','UNIDRVUI.DLL','UNIRES.DLL')
    foreach ($repairName in $repairNames) {
        $repairFile = Get-Item -LiteralPath (Join-Path $repairSource $repairName)
        if ($repairFile.VersionInfo.FileVersion -notlike '10.0.22621.*') { throw 'Unexpected Windows source version; stopping.' }
    }
    New-Item -ItemType Directory -Path $repairBackup | Out-Null
    foreach ($repairName in $repairNames) { Copy-Item -LiteralPath (Join-Path $repairTarget $repairName) -Destination (Join-Path $repairBackup $repairName) }
    try {
        Stop-Service -Name Spooler -Force
        try {
            foreach ($repairName in $repairNames) { Copy-Item -LiteralPath (Join-Path $repairSource $repairName) -Destination (Join-Path $repairTarget $repairName) -Force }
        } catch {
            foreach ($repairName in $repairNames) { Copy-Item -LiteralPath (Join-Path $repairBackup $repairName) -Destination (Join-Path $repairTarget $repairName) -Force }
            throw
        }
    } finally { Start-Service -Name Spooler }
    Write-Output "Backup: $repairBackup"
    foreach ($repairName in $repairNames) { Get-Item -LiteralPath (Join-Path $repairTarget $repairName) | Format-List Name,@{n='Version';e={$_.VersionInfo.FileVersion}} }
    Add-Type -AssemblyName System.Drawing
    $repairPrint = New-Object System.Drawing.Printing.PrintDocument
    $repairPrint.PrinterSettings.PrinterName = 'EPSON TM-T82X Receipt'
    Write-Output ('Printer settings valid: ' + $repairPrint.PrinterSettings.IsValid)
    $repairPrint.DocumentName = 'Zain diagnostic after driver repair'
    $repairPrint.add_PrintPage({ param($sender,$eventArgs)
        $repairFont = New-Object System.Drawing.Font('Arial',10)
        try { $eventArgs.Graphics.DrawString("ZAIN POS TEST`nDriver repair check`nNo sale recorded",$repairFont,[System.Drawing.Brushes]::Black,5,5) } finally { $repairFont.Dispose() }
        $eventArgs.HasMorePages=$false
    })
    try { $repairPrint.Print(); Write-Output 'Windows diagnostic job submitted successfully' } finally { $repairPrint.Dispose() }
    Get-PrintJob -PrinterName 'EPSON TM-T82X Receipt' | Format-Table ID,DocumentName,JobStatus
} catch { Write-Output ('REPAIR ERROR: ' + $_.Exception.Message); exit 1 }
finally { Stop-Transcript }
