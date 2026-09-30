#!/usr/bin/env node
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src', 'native', 'vendor', 'ryu');
const destination = join(root, 'dist', 'native', 'vendor', 'ryu');
mkdirSync(destination, { recursive: true });
for (const file of ['LICENSE-Boost', 'README.md', 'common.h', 'd2s.c', 'd2s_full_table.h', 'd2s_intrinsics.h', 'digit_table.h', 'ryu.h']) {
  cpSync(join(source, file), join(destination, file));
}
