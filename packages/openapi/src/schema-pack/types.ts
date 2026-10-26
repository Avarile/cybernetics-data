import { FieldType, Relationship, timeZoneStringSchema } from '@cybernetics/core';
import { z } from '../zod';

/**
 * A schema pack is a declarative slice of a base: tables, fields, links and computed fields,
 * written with symbolic keys instead of ids so it can be installed into any space.
 * Packs are generated from a captured source schema by
 * apps/nestjs-backend/src/features/schema-pack/extract/build-packs.ts.
 */
export const SCHEMA_PACK_IDS = ['progress', 'people', 'knowledge', 'finance'] as const;
/** Packs a user can choose. */
export const schemaPackIdSchema = z.enum(SCHEMA_PACK_IDS);
export type SchemaPackId = z.infer<typeof schemaPackIdSchema>;
/** The admin-only agent's own pack: installed by the agent, never offered in the pack wizard. */
export const AGENT_SCHEMA_PACK_ID = 'agent' as const;
/** Any pack the backend can build a catalog from (user packs and the agent pack). */
export const anySchemaPackIdSchema = z.enum([...SCHEMA_PACK_IDS, AGENT_SCHEMA_PACK_ID]);
export type AnySchemaPackId = z.infer<typeof anySchemaPackIdSchema>;

/** Placeholders substituted at install time (whole-string match only). */
export const SCHEMA_PACK_PLACEHOLDER = {
  timezone: '{{timezone}}',
  currencySymbol: '{{currencySymbol}}',
} as const;

/** `{@fieldKey}` in a formula expression refers to a field of the same table. */
export const SCHEMA_PACK_FORMULA_REF = /\{@(\w+)\}/g;

export const schemaPackKeySchema = z
  .string()
  .regex(/^[A-Z]\w{0,62}$/i, 'Keys are letters, digits and underscores');

export const schemaPackLinkSchema = z
  .object({
    table: schemaPackKeySchema.meta({ description: 'Key of the foreign table' }),
    relationship: z.enum(Relationship),
    isOneWay: z.boolean().optional(),
    lookupField: schemaPackKeySchema
      .optional()
      .meta({ description: 'Foreign field shown in the cell; defaults to the foreign primary' }),
    symmetric: z
      .object({ key: schemaPackKeySchema, name: z.string().min(1).max(255) })
      .strict()
      .optional()
      .meta({ description: 'Key and name of the field generated on the foreign table' }),
  })
  .strict();

export const schemaPackLookupSchema = z
  .object({
    link: schemaPackKeySchema.meta({ description: 'Link field of this table (may be symmetric)' }),
    field: schemaPackKeySchema.meta({ description: 'Field of the linked table' }),
  })
  .strict();

export const schemaPackFieldSchema = z
  .object({
    key: schemaPackKeySchema,
    name: z.string().min(1).max(255),
    type: z.enum(FieldType),
    isPrimary: z.boolean().optional(),
    isLookup: z.boolean().optional(),
    description: z.string().max(2000).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    link: schemaPackLinkSchema.optional(),
    lookup: schemaPackLookupSchema.optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.type === FieldType.Link && !field.link && !field.isLookup) {
      ctx.addIssue({ code: 'custom', message: 'A link field needs `link`', path: ['link'] });
    }
    if ((field.isLookup || field.type === FieldType.Rollup) && !field.lookup) {
      ctx.addIssue({
        code: 'custom',
        message: 'Lookups and rollups need `lookup`',
        path: ['lookup'],
      });
    }
  });
export type ISchemaPackField = z.infer<typeof schemaPackFieldSchema>;

export const schemaPackViewSchema = z
  .object({
    name: z.string().min(1).max(255),
    type: z.enum(['grid', 'kanban', 'calendar', 'gallery']),
    stackField: schemaPackKeySchema.optional().meta({ description: 'Kanban stack field key' }),
  })
  .strict();
export type ISchemaPackView = z.infer<typeof schemaPackViewSchema>;

export const schemaPackTableSchema = z
  .object({
    key: schemaPackKeySchema,
    name: z.string().min(1).max(255),
    icon: z.string().max(16).optional(),
    description: z.string().max(2000).optional(),
    optional: z.boolean().optional(),
    fields: schemaPackFieldSchema.array().min(1),
    views: schemaPackViewSchema.array().optional(),
  })
  .strict();
export type ISchemaPackTable = z.infer<typeof schemaPackTableSchema>;

export const schemaPackSchema = z
  .object({
    id: anySchemaPackIdSchema,
    version: z.number().int().min(1),
    tables: schemaPackTableSchema.array().min(1),
  })
  .strict();
export type ISchemaPack = z.infer<typeof schemaPackSchema>;

/** Link fields that only exist when every listed pack is installed. */
export const schemaPackBridgeSchema = z
  .object({
    packs: z.tuple([anySchemaPackIdSchema, anySchemaPackIdSchema]),
    fields: z
      .object({ table: schemaPackKeySchema, field: schemaPackFieldSchema })
      .strict()
      .array()
      .min(1),
  })
  .strict();
export type ISchemaPackBridge = z.infer<typeof schemaPackBridgeSchema>;

export const schemaPackSeedRowSchema = z
  .object({
    key: schemaPackKeySchema.optional().meta({ description: 'Lets other seed rows link here' }),
    fields: z.record(schemaPackKeySchema, z.unknown()),
    links: z.record(schemaPackKeySchema, schemaPackKeySchema.array()).optional(),
  })
  .strict();

export const schemaPackSeedSchema = z
  .object({
    pack: anySchemaPackIdSchema,
    tables: z
      .object({ table: schemaPackKeySchema, rows: schemaPackSeedRowSchema.array().min(1) })
      .strict()
      .array(),
  })
  .strict();
export type ISchemaPackSeed = z.infer<typeof schemaPackSeedSchema>;

/** Symbols written into currency formatting. */
export const SCHEMA_PACK_CURRENCIES = {
  AUD: '$',
  USD: '$',
  CAD: '$',
  NZD: '$',
  SGD: '$',
  HKD: 'HK$',
  EUR: '€',
  GBP: '£',
  CNY: '¥',
  JPY: '¥',
  INR: '₹',
  CHF: 'CHF',
} as const;
export type SchemaPackCurrency = keyof typeof SCHEMA_PACK_CURRENCIES;
const currencyCodes = Object.keys(SCHEMA_PACK_CURRENCIES) as [
  SchemaPackCurrency,
  ...SchemaPackCurrency[],
];

export const schemaPackInstallOptionsSchema = z
  .object({
    baseName: z.string().trim().min(1).max(100),
    icon: z.string().max(16).optional(),
    timezone: timeZoneStringSchema,
    currency: z.enum(currencyCodes),
    starterRows: z.boolean(),
    optionalTables: schemaPackKeySchema.array().max(50).meta({
      description: 'Optional tables the user switched on',
    }),
  })
  .strict();
export type ISchemaPackInstallOptions = z.infer<typeof schemaPackInstallOptionsSchema>;

/** Adding packs to an existing base keeps that base's name and icon. */
export const schemaPackAddOptionsSchema = schemaPackInstallOptionsSchema.omit({
  baseName: true,
  icon: true,
});
export type ISchemaPackAddOptions = z.infer<typeof schemaPackAddOptionsSchema>;

export const schemaPackSelectionSchema = schemaPackIdSchema
  .array()
  .min(1)
  .max(SCHEMA_PACK_IDS.length)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Packs must be unique' });

/* ---------- catalog (what the wizard renders) ---------- */

export const schemaPackCatalogFieldSchema = z.object({
  key: z.string(),
  name: z.string(),
  type: z.enum(FieldType),
  isLookup: z.boolean().optional(),
  linkTo: z.string().optional().meta({ description: 'Foreign table key for a link field' }),
});

export const schemaPackCatalogTableSchema = z.object({
  key: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  optional: z.boolean(),
  fields: schemaPackCatalogFieldSchema.array(),
});
export type ISchemaPackCatalogTable = z.infer<typeof schemaPackCatalogTableSchema>;

export const schemaPackCatalogVoSchema = z.object({
  packs: z
    .object({
      id: schemaPackIdSchema,
      version: z.number(),
      tables: schemaPackCatalogTableSchema.array(),
    })
    .array(),
  bridges: z
    .object({
      packs: z.tuple([schemaPackIdSchema, schemaPackIdSchema]),
      fields: z.object({ table: z.string(), field: schemaPackCatalogFieldSchema }).array(),
    })
    .array(),
  currencies: z.string().array(),
});
export type ISchemaPackCatalogVo = z.infer<typeof schemaPackCatalogVoSchema>;
