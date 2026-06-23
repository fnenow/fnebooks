const multer = require('multer');

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf'
]);


const imageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

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

  if (!imageMimeTypes.has(file.mimetype)) {
    return originalFileResult(file, 'unsupported_mime_type');
  }

  return originalFileResult(file, 'image_optimizer_not_available');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) return cb(null, true);
    const err = new Error('Receipt file must be JPG, PNG, WebP, HEIC, or PDF');
    err.statusCode = 400;
    return cb(err);
  }
});

function receiveReceiptFile(req, res, next) {
  upload.single('receipt_file')(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Receipt file must be 15 MB or smaller' });
    return res.status(err.statusCode || 400).json({ error: err.message || 'Invalid receipt file' });
  });
}

module.exports = {
  allowedMimeTypes,
  imageMimeTypes,
  optimizeReceiptFile,
  receiveReceiptFile
};
