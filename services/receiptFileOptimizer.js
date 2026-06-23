const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

const MAX_DIMENSION = Number(process.env.RECEIPT_IMAGE_MAX_DIMENSION) || 1800;
const JPEG_QUALITY = Number(process.env.RECEIPT_IMAGE_QUALITY) || 75;

function originalFileResult(file, optimizationSkipped) {
  return {
    ...file,
    originalSize: file.size,
    compressedSize: file.size,
    compressionQuality: null,
    imageWidth: null,
    imageHeight: null,
    optimized: false,
    optimizationSkipped
  };
}

async function optimizeReceiptFile(file) {
  if (!file) return null;

  if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
    return originalFileResult(file, 'unsupported_mime_type');
  }

  return originalFileResult(file, 'image_optimizer_not_available');
}

module.exports = {
  IMAGE_MIME_TYPES,
  MAX_DIMENSION,
  JPEG_QUALITY,
  optimizeReceiptFile
};
