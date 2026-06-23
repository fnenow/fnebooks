const multer = require('multer');

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf'
]);

// One submission can carry several receipt files (e.g. many JPGs, or a PDF and
// some photos). Each file is still capped individually.
const MAX_FILES = Number(process.env.RECEIPT_MAX_FILES) || 25;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) return cb(null, true);
    const err = new Error('Receipt file must be JPG, PNG, WebP, HEIC, or PDF');
    err.statusCode = 400;
    return cb(err);
  }
});

// Accept both the new multi-file field (receipt_files) and the original
// single-file field (receipt_file) so older clients keep working.
const fields = upload.fields([
  { name: 'receipt_files', maxCount: MAX_FILES },
  { name: 'receipt_file', maxCount: 1 }
]);

function collectReceiptFiles(req) {
  const grouped = req.files || {};
  return [...(grouped.receipt_files || []), ...(grouped.receipt_file || [])];
}

function receiveReceiptFiles(req, res, next) {
  fields(req, res, err => {
    if (!err) {
      req.receiptFiles = collectReceiptFiles(req);
      return next();
    }
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Each receipt file must be 15 MB or smaller' });
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: `You can upload at most ${MAX_FILES} receipt files at once` });
    }
    return res.status(err.statusCode || 400).json({ error: err.message || 'Invalid receipt file' });
  });
}

module.exports = {
  allowedMimeTypes,
  MAX_FILES,
  collectReceiptFiles,
  receiveReceiptFiles
};
