# Clear Windows Icon Cache

Write-Host "Clearing Windows icon cache..." -ForegroundColor Yellow

# Stop Explorer
Write-Host "Stopping Windows Explorer..." -ForegroundColor Cyan
Stop-Process -Name explorer -Force

# Wait a moment
Start-Sleep -Seconds 2

# Clear icon cache
Write-Host "Deleting icon cache files..." -ForegroundColor Cyan
$iconCachePath = "$env:LOCALAPPDATA\IconCache.db"
$iconCacheFolder = "$env:LOCALAPPDATA\Microsoft\Windows\Explorer"

if (Test-Path $iconCachePath) {
    Remove-Item $iconCachePath -Force -ErrorAction SilentlyContinue
    Write-Host "Deleted IconCache.db" -ForegroundColor Green
}

if (Test-Path $iconCacheFolder) {
    Get-ChildItem $iconCacheFolder -Filter "iconcache*" -Force | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem $iconCacheFolder -Filter "thumbcache*" -Force | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Host "Deleted icon cache files from Explorer folder" -ForegroundColor Green
}

# Restart Explorer
Write-Host "Restarting Windows Explorer..." -ForegroundColor Cyan
Start-Process explorer.exe

Write-Host "`nIcon cache cleared successfully!" -ForegroundColor Green
Write-Host "Please wait a few seconds for Explorer to fully restart." -ForegroundColor Yellow
