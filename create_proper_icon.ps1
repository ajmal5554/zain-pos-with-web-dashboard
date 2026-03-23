Add-Type -AssemblyName System.Drawing

$pngPath = "C:\Users\PC\.gemini\antigravity\brain\245df4e8-99b7-43c5-81fa-1d790d673e93\zain_pos_icon_1770188518105.png"
$icoPath = "c:\Users\PC\Downloads\zain-pos-desktop-master\zain-pos-desktop-master\build\icon.ico"

Write-Host "Loading PNG image..." -ForegroundColor Cyan
$img = [System.Drawing.Image]::FromFile($pngPath)

Write-Host "Creating icon with multiple sizes..." -ForegroundColor Cyan

# Create a memory stream for the ICO file
$memoryStream = New-Object System.IO.MemoryStream

# ICO file header
$writer = New-Object System.IO.BinaryWriter($memoryStream)
$writer.Write([UInt16]0)  # Reserved
$writer.Write([UInt16]1)  # Type (1 = ICO)
$writer.Write([UInt16]1)  # Number of images

# Icon directory entry for 256x256
$writer.Write([byte]0)    # Width (0 = 256)
$writer.Write([byte]0)    # Height (0 = 256)
$writer.Write([byte]0)    # Color palette
$writer.Write([byte]0)    # Reserved
$writer.Write([UInt16]1)  # Color planes
$writer.Write([UInt16]32) # Bits per pixel
$writer.Write([UInt32]0)  # Size of image data (placeholder)
$writer.Write([UInt32]22) # Offset to image data

# Create 256x256 PNG data
$icon256 = New-Object System.Drawing.Bitmap(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($icon256)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.DrawImage($img, 0, 0, 256, 256)
$graphics.Dispose()

# Save as PNG to memory stream
$pngStream = New-Object System.IO.MemoryStream
$icon256.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngData = $pngStream.ToArray()
$pngStream.Dispose()
$icon256.Dispose()

# Update size in header
$memoryStream.Seek(14, [System.IO.SeekOrigin]::Begin) | Out-Null
$writer.Write([UInt32]$pngData.Length)

# Write PNG data
$memoryStream.Seek(0, [System.IO.SeekOrigin]::End) | Out-Null
$writer.Write($pngData)

# Save to file
$writer.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $memoryStream.ToArray())

$writer.Dispose()
$memoryStream.Dispose()
$img.Dispose()

Write-Host "Successfully created icon at: $icoPath" -ForegroundColor Green
Write-Host "Icon size: $([System.IO.FileInfo]::new($icoPath).Length) bytes" -ForegroundColor Green

# Copy to public folder as well
$publicPath = "c:\Users\PC\Downloads\zain-pos-desktop-master\zain-pos-desktop-master\public\icon.ico"
Copy-Item $icoPath $publicPath -Force
Write-Host "Copied to public folder as well" -ForegroundColor Green
