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
