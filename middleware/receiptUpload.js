const multer = require('multer');

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf'
]);

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
  receiveReceiptFile
};
