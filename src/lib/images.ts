/** Reads a picture and shrinks it if large, so backups stay a sensible size. */
export async function imageToDataUrl(file: File, maxSide = 1600): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  if (file.type === 'image/svg+xml' || file.size < 300_000) return original;

  const img = new Image();
  img.src = original;
  await img.decode();
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return original;
  // White behind transparent areas, since JPEG has no transparency.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const shrunk = canvas.toDataURL('image/jpeg', 0.85);
  return shrunk.length < original.length ? shrunk : original;
}
