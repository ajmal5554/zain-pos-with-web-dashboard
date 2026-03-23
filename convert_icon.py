from PIL import Image
import sys

def convert_png_to_ico(png_path, ico_path):
    """Convert PNG to ICO with multiple sizes for Windows"""
    img = Image.open(png_path)
    
    # Create ICO with multiple sizes (Windows standard)
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    
    # Resize and save
    img.save(ico_path, format='ICO', sizes=sizes)
    print(f"Successfully converted {png_path} to {ico_path}")

if __name__ == "__main__":
    png_file = r"C:\Users\PC\.gemini\antigravity\brain\245df4e8-99b7-43c5-81fa-1d790d673e93\zain_pos_icon_1770188518105.png"
    ico_file = r"c:\Users\PC\Downloads\zain-pos-desktop-master\zain-pos-desktop-master\public\icon.ico"
    
    convert_png_to_ico(png_file, ico_file)
