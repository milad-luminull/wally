// The shared config lives in packages/config and is exported as "@wally/config/prettier",
// but nothing at the repo root referenced it — so `prettier` resolved NO config and fell
// back to its defaults (double quotes, 80 columns), which is not this project's style.
// Re-export it here so the root `format` / `format:check` scripts, editors and the CI gate
// all agree with packages/config/prettier.config.js.
export { default } from './packages/config/prettier.config.js';
