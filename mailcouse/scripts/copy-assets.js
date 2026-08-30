const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sourcePath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destPath);
    }
  }
}

copyDir(path.join(root, 'src', 'views'), path.join(root, 'dist', 'views'));
copyDir(path.join(root, 'src', 'public'), path.join(root, 'dist', 'public'));
fs.mkdirSync(path.join(root, 'dist', 'db'), { recursive: true });
fs.copyFileSync(path.join(root, 'src', 'db', 'schema.sql'), path.join(root, 'dist', 'db', 'schema.sql'));

// Copy verifier binary if present
const isWindows = process.platform === 'win32';
const binName = isWindows ? 'email-verifier.exe' : 'email-verifier';
const toolBin = path.join(root, 'tools', 'email-verifier', binName);
const distBin = path.join(root, 'dist', 'bin', binName);
if (fs.existsSync(toolBin)) {
  fs.mkdirSync(path.join(root, 'dist', 'bin'), { recursive: true });
  fs.copyFileSync(toolBin, distBin);
  if (!isWindows) {
    try { fs.chmodSync(distBin, 0o755); } catch {}
  }
}