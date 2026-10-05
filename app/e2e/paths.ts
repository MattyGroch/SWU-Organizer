import { fileURLToPath } from 'node:url';

/** Scratch files the tests make; gitignored. */
export const CACHE_DIR = fileURLToPath(new URL('./.cache/', import.meta.url));
/** The fake camera's video: one card, held a little small and off-centre. */
export const FAKE_CAMERA = `${CACHE_DIR}camera.y4m`;
/**
 * A second camera showing something card-like the index can't match — the same card
 * mirrored and colour-inverted — for the "couldn't recognise this card" path.
 */
export const UNKNOWN_CAMERA = `${CACHE_DIR}unknown.y4m`;
/** The card it shows. */
export const CAMERA_CARD = { setKey: 'SOR', num: '059', name: '2-1B Surgical Droid' };
