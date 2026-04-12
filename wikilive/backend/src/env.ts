import fs from 'fs';
import { config } from 'dotenv';
import path from 'path';

const envCandidates = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    config({ path: envPath, quiet: true });
    break;
  }
}

const secret = process.env.COOKIE_SECRET;
if (!secret || secret.trim() === '') {
  throw new Error('COOKIE_SECRET environment variable is required. Set it before starting the server.');
}

const normalizedSecret = secret.trim().toLowerCase();
const blockedCookieSecrets = new Set([
  'dev_cookie_secret_change_in_production_12345',
  'changeme',
  'change-me',
  'secret',
  'cookie_secret',
]);

if (secret.trim().length < 16) {
  throw new Error('COOKIE_SECRET must be at least 16 characters long.');
}

if (normalizedSecret.includes('dev_cookie_secret') || blockedCookieSecrets.has(normalizedSecret)) {
  throw new Error('COOKIE_SECRET uses an insecure default or placeholder value. Set a strong random secret.');
}
