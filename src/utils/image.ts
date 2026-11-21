export interface CompressedImage {
  url: string;
  width: number;
  height: number;
}

// 画像ファイルを適度なサイズに圧縮し、ノード表示用の推奨サイズも計算して返す
export async function compressImageToBase64(
  file: File,
  maxDimension = 1000,
  quality = 0.82
): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        let dataUrl = e.target?.result as string;

        if (width > maxDimension || height > maxDimension || file.size >= 150 * 1024) {
          if (width > height && width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            dataUrl = canvas.toDataURL('image/webp', quality);
          }
        }

        // ノード内での表示サイズ（最大幅 220px にスケーリング）
        const maxDisplayWidth = 220;
        let displayWidth = width;
        let displayHeight = height;
        if (displayWidth > maxDisplayWidth) {
          displayHeight = Math.round((displayHeight * maxDisplayWidth) / displayWidth);
          displayWidth = maxDisplayWidth;
        }

        resolve({
          url: dataUrl,
          width: displayWidth,
          height: displayHeight
        });
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
