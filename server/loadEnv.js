import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const getEnvDirectory = () => {
  if (process.env.AFRISTOCK_DATA_DIR) return process.env.AFRISTOCK_DATA_DIR;
  if (process.env.VERCEL || process.env.VERCEL_ENV || (process.platform !== 'win32' && !process.env.LOCALAPPDATA)) {
    return path.join(os.tmpdir(), 'AfriStock');
  }
  const localDataDirectory = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localDataDirectory, 'AfriStock');
};

export const localEnvPath = path.join(getEnvDirectory(), '.env');

export const loadLocalEnv = () => {
  try {
    if (!fs.existsSync(localEnvPath)) return;
    const result = dotenv.config({ path: localEnvPath });
    if (result.error) console.warn('Erreur de lecture du .env local:', result.error.message);
  } catch {
    // Ne pas bloquer l'application
  }
};

const protectPath = (targetPath, isDirectory) => {
  try {
    if (process.platform === 'win32') {
      const account = process.env.USERDOMAIN && process.env.USERNAME
        ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
        : process.env.USERNAME;
      if (!account) return;
      const permissions = isDirectory ? ':(OI)(CI)(F)' : ':(F)';
      execFileSync('icacls.exe', [
        targetPath,
        '/inheritance:r',
        '/grant:r',
        `${account}${permissions}`,
        `NT AUTHORITY\\SYSTEM${permissions}`,
      ], { windowsHide: true, stdio: 'ignore' });
      return;
    }

    fs.chmodSync(targetPath, isDirectory ? 0o700 : 0o600);
  } catch {
    // Environnement restreint ou conteneurisé : ne pas bloquer
  }
};

export const secureLocalDirectory = (directory) => {
  try {
    fs.mkdirSync(directory, { recursive: true });
    protectPath(directory, true);
  } catch {
    // ignore
  }
};

export const secureLocalFile = (filePath) => {
  try {
    protectPath(filePath, false);
  } catch {
    // ignore
  }
};

export const saveLocalEnvValues = (values) => {
  try {
    const directory = path.dirname(localEnvPath);
    secureLocalDirectory(directory);
    let content = fs.existsSync(localEnvPath) ? fs.readFileSync(localEnvPath, 'utf8') : '';

    for (const [key, value] of Object.entries(values)) {
      const line = `${key}=${value}`;
      const pattern = new RegExp(`^${key}=.*$`, 'm');
      content = pattern.test(content)
        ? content.replace(pattern, line)
        : `${content.trimEnd()}${content.trim() ? '\n' : ''}${line}\n`;
    }

    fs.writeFileSync(localEnvPath, content, { mode: 0o600 });
    secureLocalFile(localEnvPath);
  } catch {
    // Ne pas bloquer si le système de fichiers est en lecture seule
  }
};

export const ensureLocalSecrets = () => {
  loadLocalEnv();
  if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32) {
    const secret = crypto.randomBytes(48).toString('hex');
    try {
      saveLocalEnvValues({ SESSION_SECRET: secret });
    } catch {
      // ignore
    }
    process.env.SESSION_SECRET = secret;
  }
};

ensureLocalSecrets();
