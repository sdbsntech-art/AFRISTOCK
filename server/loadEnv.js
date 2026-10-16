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

export const saveLocalEnvValues = (values) => {
  const directory = path.dirname(localEnvPath);
  fs.mkdirSync(directory, { recursive: true });
  if (process.platform === 'win32') {
    const account = process.env.USERDOMAIN && process.env.USERNAME
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : process.env.USERNAME;
    if (!account) throw new Error('Impossible d’identifier le compte Windows pour sécuriser le fichier local AfriStock.');
    execFileSync('icacls.exe', [
      directory,
      '/inheritance:r',
      '/grant:r',
      `${account}:(OI)(CI)(F)`,
      'NT AUTHORITY\\SYSTEM:(OI)(CI)(F)',
    ], { windowsHide: true, stdio: 'ignore' });
  }

  let content = fs.existsSync(localEnvPath) ? fs.readFileSync(localEnvPath, 'utf8') : '';

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    content = pattern.test(content)
      ? content.replace(pattern, line)
      : `${content.trimEnd()}${content.trim() ? '\n' : ''}${line}\n`;
  }

  fs.writeFileSync(localEnvPath, content, { mode: 0o600 });
  if (process.platform === 'win32') {
    const account = process.env.USERDOMAIN && process.env.USERNAME
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : process.env.USERNAME;
    execFileSync('icacls.exe', [
      localEnvPath,
      '/inheritance:r',
      '/grant:r',
      `${account}:(F)`,
      'NT AUTHORITY\\SYSTEM:(F)',
    ], { windowsHide: true, stdio: 'ignore' });
  }
};

loadLocalEnv();
