// Generate a printable QR PNG for the captain join URL.
// Usage: node scripts/makeQR.js https://ptgame.tetherlo.com/play
import QRCode from 'qrcode';
import path from 'node:path';

const url = process.argv[2] || 'https://ptgame.tetherlo.com/play';
const out = path.resolve('public/assets/join-qr.png');

QRCode.toFile(out, url, { width: 800, margin: 2, color: { dark: '#1a0f3d', light: '#ffffff' } })
  .then(() => console.log(`QR for ${url}\nsaved → ${out}`))
  .catch((e) => { console.error(e); process.exit(1); });
