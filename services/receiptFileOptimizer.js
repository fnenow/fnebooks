const path = require('path');

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

const MAX_DIMENSION = Number(process.env.RECEIPT_IMAGE_MAX_DIMENSION) || 1800;
const JPEG_QUALITY = Number(process.env.RECEIPT_IMAGE_QUALITY) || 75;

function hasSharp() {
  try {
    require.resolve('sharp');
    return true;
  } catch {
    return false;
  }
}

function optimizedFilename(originalName, mimeType) {
  if (mimeType !== 'image/jpeg') return originalName;
  const parsed = path.parse(originalName || 'receipt');
  return `${parsed.name || 'receipt'}.jpg`;
}

async function optimizeReceiptFile(file) {
  if (!file) return null;

  const original = {
    ...file,
    originalSize: file.size,
    compressedSize: file.size,
    compressionQuality: null,
    imageWidth: null,
    imageHeight: null,
    optimized: false,
    optimizationSkipped: null
  };

  if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
    return { ...original, optimizationSkipped: 'unsupported_mime_type' };
  }

  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    return { ...original, optimizationSkipped: 'sharp_not_installed' };
  }

  const image = sharp(file.buffer, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || null;
  const height = metadata.height || null;

  const output = await image
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  if (!output.length || output.length >= file.buffer.length) {
    return {
      ...original,
      imageWidth: width,
      imageHeight: height,
      optimizationSkipped: 'optimized_not_smaller'
    };
  }

  return {
    ...file,
    buffer: output,
    size: output.length,
    mimetype: 'image/jpeg',
    originalname: optimizedFilename(file.originalname, 'image/jpeg'),
    originalSize: file.size,
    compressedSize: output.length,
    compressionQuality: JPEG_QUALITY,
    imageWidth: width,
    imageHeight: height,
    optimized: true,
    optimizationSkipped: null
  };
}

module.exports = {
  IMAGE_MIME_TYPES,
  MAX_DIMENSION,
  JPEG_QUALITY,
  hasSharp,
  optimizeReceiptFile
};
