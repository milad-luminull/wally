/**
 * The Prisma Client is generated to prisma/generated/client (see the `output` in
 * prisma/schema.prisma), not the default node_modules/.prisma location — this repo's
 * root .gitignore already anticipates `apps/api/prisma/generated/`. Every other module
 * imports PrismaClient/Prisma/model types from HERE instead of '@prisma/client' directly,
 * so this file is the one place that needs to know the real relative path.
 *
 * This module only exists after `pnpm --filter @wally/api db:generate` (or `prisma
 * generate`) has run — it's generated, not checked in.
 */
export * from '../../prisma/generated/client/index.js';
