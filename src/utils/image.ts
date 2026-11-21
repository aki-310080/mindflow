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

// 画像URLから画像サイズを取得し（可能なら圧縮Base64化して）ノード表示用データを返す
export async function loadImageUrlToCompressed(imageUrl: string): Promise<CompressedImage> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const maxDisplayWidth = 220;
      let displayWidth = img.naturalWidth || 200;
      let displayHeight = img.naturalHeight || 150;
      if (displayWidth > maxDisplayWidth) {
        displayHeight = Math.round((displayHeight * maxDisplayWidth) / displayWidth);
        displayWidth = maxDisplayWidth;
      }

      // 可能であればCanvas経由で軽量WebP化（CORS許可画像の場合）
      try {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const maxDim = 1000;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/webp', 0.82);
          resolve({ url: dataUrl, width: displayWidth, height: displayHeight });
          return;
        }
      } catch {
        // CORS制限等でCanvas変換できない場合は元URLをそのまま使用
      }

      resolve({ url: imageUrl, width: displayWidth, height: displayHeight });
    };
    img.onerror = () => {
      // 読み込みエラー時もフォールバックサイズで返す
      resolve({ url: imageUrl, width: 200, height: 140 });
    };
    img.src = imageUrl;
  });
}
