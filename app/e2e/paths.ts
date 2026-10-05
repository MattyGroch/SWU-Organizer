import { fileURLToPath } from 'node:url';

/** Scratch files the tests make; gitignored. */
export const CACHE_DIR = fileURLToPath(new URL('./.cache/', import.meta.url));
/** The fake camera's video: one card, held a little small and off-centre. */
export const FAKE_CAMERA = `${CACHE_DIR}camera.y4m`;
/** The card it shows. */
export const CAMERA_CARD = { setKey: 'SOR', num: '059', name: '2-1B Surgical Droid' };
