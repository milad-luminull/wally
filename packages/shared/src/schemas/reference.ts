import { z } from 'zod';
import { referenceTypeSchema } from '../enums.js';

export const referenceOptionQuerySchema = z.object({
  type: referenceTypeSchema,
});
export type ReferenceOptionQuery = z.infer<typeof referenceOptionQuerySchema>;

export const referenceOptionDtoSchema = z.object({
  id: z.string(),
  type: referenceTypeSchema,
  label: z.string(),
});
export type ReferenceOptionDto = z.infer<typeof referenceOptionDtoSchema>;
