/**
 * 把截图缩到模型能接受的尺寸。
 *
 * 2K 屏的一张 PNG 转成 base64 能有 4MB 上下，直接塞进请求里，
 * 轻则慢得离谱，重则被服务商按体积拒掉。
 * 这里缩到 1024px 宽、转 JPEG —— 看界面上的文字和按钮够用。
 * 1024 是权衡：再大 token 涨得快，再小字就看不清了。
 */

export async function shrinkImage(
  dataUrl: string,
  maxWidth = 1024,
  quality = 0.82,
): Promise<string> {
  try {
    const image = await loadImage(dataUrl);
    // 已经比目标还小就别折腾，重编码只会掉画质
    if (image.width <= maxWidth) return dataUrl;

    const scale = maxWidth / image.width;
    const canvas = document.createElement('canvas');
    canvas.width = maxWidth;
    canvas.height = Math.round(image.height * scale);

    const context = canvas.getContext('2d');
    if (!context) return dataUrl;

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    // 压不了就用原图，总比没有强
    return dataUrl;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });
}
