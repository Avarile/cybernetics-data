import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { schemaPackCatalogVoSchema } from './types';
import type { ISchemaPackCatalogVo } from './types';

export const GET_SCHEMA_PACK_CATALOG = '/schema-pack';

export const GetSchemaPackCatalogRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SCHEMA_PACK_CATALOG,
  description: 'List the schema packs a new base can be built from',
  responses: {
    200: {
      description: 'The pack catalog.',
      content: { 'application/json': { schema: schemaPackCatalogVoSchema } },
    },
  },
  tags: ['schema-pack'],
});

export const getSchemaPackCatalog = async () => {
  return axios.get<ISchemaPackCatalogVo>(GET_SCHEMA_PACK_CATALOG);
};
