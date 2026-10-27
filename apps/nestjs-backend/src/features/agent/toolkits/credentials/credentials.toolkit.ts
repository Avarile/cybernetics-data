import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ICredentialRef } from '../../domain/entities';
import { AGENT_STORE_PORT, type IAgentStorePort } from '../../domain/ports';
import { ToolkitRegistry } from '../toolkit.registry';
import type { IToolkit } from '../toolkit.types';
import { defineTool } from '../toolkit.types';

/** Where the admin types a secret (Admin ▸ Agent ▸ Credentials); never into the chat. */
export const setSecretPath = (credentialId: string) => `/admin/agent?credential=${credentialId}`;

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'use a short slug such as github or hubspot')
  .max(64);
const host = z
  .string()
  .regex(/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/i, 'a host name such as api.github.com');
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const view = (c: ICredentialRef) => ({
  name: c.name,
  description: c.description,
  authKind: c.authKind,
  allowedHosts: c.allowedHosts,
  allowedMethods: c.allowedMethods,
  status: c.status,
  expiresAt: c.expiresAt,
});

/**
 * credential_list / credential_request (design §8, D4). Metadata only: no tool can read a secret,
 * and a secret is never asked for in the chat.
 */
@Injectable()
export class CredentialsToolkit implements IToolkit, OnModuleInit {
  readonly id = 'credentials' as const;
  readonly title = 'Credentials';
  readonly tools;

  constructor(
    private readonly registry: ToolkitRegistry,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort
  ) {
    this.tools = [this.list(), this.request()];
  }

  onModuleInit() {
    this.registry.register(this);
  }

  private list() {
    return defineTool({
      name: 'credential_list',
      description:
        'List the credentials you can use with http_request: name, hosts, methods and whether the secret is set.',
      input: z.object({}),
      execute: async () => ({ credentials: (await this.store.listCredentials()).map(view) }),
    });
  }

  private request() {
    return defineTool({
      name: 'credential_request',
      description:
        'Ask the admin for a credential you need. Never ask for a secret in the chat: this returns a link where the admin enters it.',
      input: z.object({
        name: slug,
        why: z.string().min(1).max(1000).describe('what you need it for'),
        hosts: z.array(host).min(1).max(20),
        kind: z.enum(['bearer', 'header', 'query_param', 'basic', 'oauth2_client_credentials']),
        headerName: z.string().max(100).optional(),
        queryParam: z.string().max(100).optional(),
        methods: z.array(z.enum(methods)).min(1).optional(),
      }),
      execute: async (input) => {
        const existing = await this.store.getCredentialByName(input.name);
        const credential =
          existing ??
          (await this.store.createCredential({
            name: input.name,
            description: input.why,
            authKind: input.kind,
            headerName: input.headerName ?? null,
            queryParam: input.queryParam ?? null,
            allowedHosts: input.hosts.map((h) => h.toLowerCase()),
            allowedMethods: input.methods ?? ['GET'],
            status: 'missing',
          }));
        return {
          name: credential.name,
          status: credential.status,
          created: !existing,
          setSecretUrl: setSecretPath(credential.id),
          tellTheAdmin:
            credential.status === 'set'
              ? 'This credential is already set.'
              : 'Ask the admin to open setSecretUrl and enter the secret there. Do not ask for it in the chat.',
        };
      },
    });
  }
}
