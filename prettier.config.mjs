// The shared config lives in packages/config. Without a root config `prettier` would fall
// back to its defaults (double quotes, 80 columns), which is not this project's style.
// Re-export it here so the root `format` / `format:check` scripts, editors and the CI gate
// all agree with packages/config/prettier.config.js.
export { default } from './packages/config/prettier.config.js';
