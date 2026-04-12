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

// Проверка секрета — падаем только если совсем нет, для дефолта делаем warning
const secret = process.env.COOKIE_SECRET;
if (!secret || secret.trim() === '') {
  throw new Error('COOKIE_SECRET environment variable is required. Set it before starting the server.');
}

// Warning для дефолтного development секрета
if (secret.toLowerCase().includes('dev_cookie_secret')) {
  console.warn('⚠️  WARNING: Using default development COOKIE_SECRET. This is insecure for production!');
  console.warn('   Set a strong random COOKIE_SECRET in production.');
}
