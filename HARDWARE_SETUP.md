# Hardware Setup Guide - Zain POS

This guide will help you set up the hardware components for your POS system.

## Required Hardware

1. **Epson Thermal Receipt Printer** (e.g., TM-T82, TM-T88)
2. **TSC Barcode Label Printer** (e.g., TTP-244 Plus, TTP-345)
3. **USB Barcode Scanner** (any standard USB scanner)
4. **Computer** running Windows 10/11

## 1. Epson Receipt Printer Setup

### Installation Steps

1. **Download Drivers**
   - Visit: https://epson.com/Support/Printers/
   - Search for your printer model (e.g., TM-T82)
   - Download the latest Windows driver

2. **Install Driver**
   - Run the downloaded installer
   - Follow the installation wizard
   - Connect printer via USB when prompted
   - Complete the installation

3. **Configure Printer**
   - Open Windows Settings → Devices → Printers & scanners
   - Find your Epson printer
   - Click "Manage" → "Printing preferences"
   - Set paper size to 80mm (or your receipt width)
   - Set print quality to "Standard"

4. **Test Print**
   - In Zain POS, go to Settings
   - Click "Test Receipt Printer"
   - Verify the test receipt prints correctly

### Troubleshooting

- **Printer not detected**: Check USB cable, try different USB port
- **Prints blank**: Check paper roll is installed correctly
- **Slow printing**: Update to latest driver version

## 2. TSC Label Printer Setup

### Installation Steps

1. **Download Drivers**
   - Visit: https://www.tscprinters.com/
   - Go to Support → Downloads
   - Select your printer model
   - Download Windows driver

2. **Install Driver**
   - Run the installer
   - Connect printer via USB
   - Complete installation

3. **Configure Label Size**
   - Open TSC printer preferences
   - Set label size: **40mm x 30mm** (standard for clothing tags)
   - Set print speed: Medium
   - Set darkness: 10-12 (adjust based on label material)

4. **Calibrate Printer**
   - Press and hold the FEED button for 3 seconds
   - Printer will auto-calibrate the label sensor
   - Test with a few labels

5. **Test Print**
   - In Zain POS, go to Products
   - Select any product
   - Click the Print icon
   - Verify label prints with barcode, product name, and price

### Label Specifications

- **Size**: 40mm x 30mm (1.57" x 1.18")
- **Material**: Thermal paper or synthetic
- **Adhesive**: Permanent or removable
- **Core**: 25mm (1")

### Troubleshooting

- **Labels not feeding**: Recalibrate sensor
- **Barcode not scanning**: Increase darkness setting
- **Misaligned print**: Check label size settings

## 3. Barcode Scanner Setup

### Installation Steps

1. **Connect Scanner**
   - Plug USB barcode scanner into computer
   - Windows will automatically install drivers
   - Wait for "Device ready" notification

2. **Configure Scanner** (if needed)
   - Most scanners work out-of-the-box
   - If needed, scan configuration barcodes from scanner manual
   - Set to add "Enter" key after scan (usually default)

3. **Test Scanner**
   - Open Notepad
   - Scan a barcode
   - Verify the barcode number appears followed by a new line

4. **Use in POS**
   - Go to POS page in Zain POS
   - Barcode input field is auto-focused
   - Scan product barcode
   - Product automatically adds to cart

### Supported Barcode Types

- **EAN-13** (default for products)
- **CODE-128**
- **UPC-A**
- **CODE-39**

### Troubleshooting

- **Scanner not working**: Check USB connection, try different port
- **Beeps but doesn't scan**: Barcode may be damaged or wrong type
- **Scans but nothing happens**: Check cursor is in barcode input field

## 4. Network Setup (Optional)

If you want to use network printers:

### Epson Network Setup

1. Connect printer to network via Ethernet
2. Print network configuration page
3. Note the IP address
4. Add network printer in Windows using IP address

### TSC Network Setup

1. Connect printer to network
2. Use TSC Console to configure IP settings
3. Add as network printer in Windows

## 5. Recommended Setup

### Physical Layout

```
[Computer Monitor]
        |
[Computer/CPU]
        |
    [USB Hub]
   /    |    \
[Scanner] [Epson] [TSC]
```

### Cable Management

- Use a powered USB hub for all devices
- Keep cables organized and labeled
- Leave slack for printer paper changes

## 6. Maintenance

### Daily

- Check paper levels in both printers
- Clean scanner lens with microfiber cloth
- Test scan a few barcodes

### Weekly

- Clean Epson print head (use cleaning card)
- Check TSC label alignment
- Inspect cables for damage

### Monthly

- Deep clean Epson printer (follow manual)
- Replace TSC print head if quality degrades
- Update printer drivers if available

## 7. Backup Printers

It's recommended to have:
- 1 spare receipt printer
- Extra thermal paper rolls
- Extra label rolls
- Backup USB cables

## 8. Support Contacts

### Epson Support
- Website: epson.com/support
- Phone: Check regional support number

### TSC Support
- Website: tscprinters.com/support
- Email: support@tscprinters.com

### Local Vendor
- Keep contact of your hardware supplier
- Arrange for on-site support if needed

## 9. Cost Estimates (India)

- **Epson TM-T82**: ₹8,000 - ₹12,000
- **TSC TTP-244 Plus**: ₹15,000 - ₹20,000
- **USB Barcode Scanner**: ₹1,500 - ₹3,000
- **Thermal Paper Rolls** (80mm): ₹30-50 per roll
- **Label Rolls** (40x30mm, 1000 labels): ₹200-400 per roll

---

For technical support, contact: 9037106449, 7907026827
