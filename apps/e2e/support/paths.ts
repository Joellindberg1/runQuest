import { fileURLToPath } from 'node:url';

/** Inloggningen sparas här av setup-projektet och återanvänds av övriga specer. Mappen är gitignorerad: filen innehåller en giltig JWT. */
export const AUTH_FILE = fileURLToPath(new URL('../.auth/user.json', import.meta.url));
