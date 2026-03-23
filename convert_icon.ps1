Add-Type -AssemblyName System.Drawing

$pngPath = "C:\Users\PC\.gemini\antigravity\brain\245df4e8-99b7-43c5-81fa-1d790d673e93\zain_pos_icon_1770188518105.png"
$icoPath = "c:\Users\PC\Downloads\zain-pos-desktop-master\zain-pos-desktop-master\public\icon.ico"

# Load the PNG image
$img = [System.Drawing.Image]::FromFile($pngPath)

# Create a new bitmap with the desired size
$icon = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($icon)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.DrawImage($img, 0, 0, 256, 256)

# Save as ICO
$icon.Save($icoPath, [System.Drawing.Imaging.ImageFormat]::Icon)

$graphics.Dispose()
$icon.Dispose()
$img.Dispose()

Write-Host "Successfully converted PNG to ICO: $icoPath"
