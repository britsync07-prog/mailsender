const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const toolDir = path.join(rootDir, 'tools', 'email-verifier');
const distBinDir = path.join(rootDir, 'dist', 'bin');
const binDir = path.join(rootDir, 'bin');

const isWindows = process.platform === 'win32';
const binName = isWindows ? 'email-verifier.exe' : 'email-verifier';
const targetInTool = path.join(toolDir, binName);
const targetInDist = path.join(distBinDir, binName);
const targetInBin = path.join(binDir, binName);

function buildVerifier() {
  if (!fs.existsSync(toolDir)) {
    console.log('[build-verifier] tools/email-verifier directory not found, skipping compilation.');
    return;
  }

  try {
    // Check if Go is installed
    execSync('go version', { stdio: 'ignore' });
  } catch {
    console.log('[build-verifier] Note: Go compiler not found on PATH. Application will use runtime invocation or DNS fail-safe.');
    return;
  }

  try {
    console.log('[build-verifier] Compiling AfterShip email-verifier engine...');
    execSync(`go build -o "${targetInTool}" main.go`, {
      cwd: toolDir,
      stdio: 'inherit',
      timeout: 30000,
    });

    // Ensure dist/bin and bin directories exist and copy binary
    fs.mkdirSync(distBinDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });

    fs.copyFileSync(targetInTool, targetInDist);
    fs.copyFileSync(targetInTool, targetInBin);

    // Ensure executable permissions on Linux/macOS
    if (!isWindows) {
      try {
        fs.chmodSync(targetInTool, 0o755);
        fs.chmodSync(targetInDist, 0o755);
        fs.chmodSync(targetInBin, 0o755);
      } catch {}
    }

    console.log(`[build-verifier] Successfully built email-verifier binary -> ${targetInTool}`);
  } catch (err) {
    console.warn(`[build-verifier] Warning during Go compilation: ${err.message}. Runtime fallback will be used.`);
  }
}

buildVerifier();
