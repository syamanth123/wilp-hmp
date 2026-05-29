import { PrismaClient } from '@prisma/client';

declare global {
  var __hmpPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__hmpPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__hmpPrisma = prisma;
}

export * from '@prisma/client';
export * from './notification-templates';
export {
  BitsHandoutSchemaV1,
  BitsHandoutSchema,
  LATEST_SCHEMA_VERSION,
  type BitsHandoutV1,
  type BitsHandout,
} from './handout-schema';
export { normalizeBitsCourseNumber, bitsCourseNumberSchema, getDiscipline } from './course-code';
