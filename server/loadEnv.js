import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const localDataDirectory = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
export const localEnvPath = path.join(localDataDirectory, 'AfriStock', '.env');

export const loadLocalEnv = () => {
  if (!fs.existsSync(localEnvPath)) return;
  const result = dotenv.config({ path: localEnvPath });
  if (result.error) throw result.error;
};

const protectPath = (targetPath, isDirectory) => {
  if (process.platform === 'win32') {
    const account = process.env.USERDOMAIN && process.env.USERNAME
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : process.env.USERNAME;
    if (!account) throw new Error('Impossible d’identifier le compte Windows pour protéger les données AfriStock.');
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
};

export const secureLocalDirectory = (directory) => {
  fs.mkdirSync(directory, { recursive: true });
  protectPath(directory, true);
};

export const secureLocalFile = (filePath) => {
  protectPath(filePath, false);
};

export const saveLocalEnvValues = (values) => {
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
};

export const ensureLocalSecrets = () => {
  loadLocalEnv();
  if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32) {
    const secret = crypto.randomBytes(48).toString('hex');
    saveLocalEnvValues({ SESSION_SECRET: secret });
    process.env.SESSION_SECRET = secret;
  }
};

ensureLocalSecrets();
