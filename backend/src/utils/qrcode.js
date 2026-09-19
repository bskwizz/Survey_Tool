'use strict';

const QRCode = require('qrcode');

/** Returns a PNG Buffer suitable for an HTTP image response. */
async function generateQrPngBuffer(text) {
  return QRCode.toBuffer(text, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  });
}

/** Returns a data: URI (useful for embedding directly in JSON API responses / the Office add-in). */
async function generateQrDataUri(text) {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  });
}

module.exports = { generateQrPngBuffer, generateQrDataUri };
