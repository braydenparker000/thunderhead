// @ts-check
// Deliberately wrong: proves the JSDoc check against shared/contract is not vacuous.
// tests/contract.test.mjs expects TypeScript to reject both lines below.

/** @typedef {import('../../shared/contract/api.ts').LoginRequest} LoginRequest */
/** @typedef {import('../../shared/contract/api.ts').HealthResponse} HealthResponse */

/** @type {LoginRequest} */
export const request = { username: 'example-owner', pasword: 'typo in the field name', device: {} };

/** @param {HealthResponse} h */
export const version = (h) => h.version.id.toFixed(2);
