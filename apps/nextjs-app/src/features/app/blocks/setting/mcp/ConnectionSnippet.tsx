import { Check, Copy } from '@teable/icons';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { mcpConfig } from '@/features/i18n/mcp.config';

interface IConnectionSnippetProps {
  endpoint: string;
}

const TOKEN_PLACEHOLDER = '<your-access-token>';

export const ConnectionSnippet = ({ endpoint }: IConnectionSnippetProps) => {
  const { t } = useTranslation(mcpConfig.i18nNamespaces);
  const [copied, setCopied] = useState<string | null>(null);

  const cli = `claude mcp add --transport http cybernetics ${endpoint} \\
  --header "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`;

  const json = JSON.stringify(
    {
      mcpServers: {
        cybernetics: {
          type: 'http',
          url: endpoint,
          headers: { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` },
        },
      },
    },
    null,
    2
  );

  const copy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const snippet = (key: string, value: string) => (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
        <code>{value}</code>
      </pre>
      <Button
        size="xs"
        variant="ghost"
        className="absolute right-2 top-2"
        onClick={() => copy(key, value)}
      >
        {copied === key ? <Check className="size-3" /> : <Copy className="size-3" />}
        <span className="ml-1">
          {copied === key ? t('mcp:connect.copied') : t('mcp:connect.copy')}
        </span>
      </Button>
    </div>
  );

  return (
    <Tabs defaultValue="cli">
      <TabsList>
        <TabsTrigger value="cli">{t('mcp:connect.claudeCode')}</TabsTrigger>
        <TabsTrigger value="json">{t('mcp:connect.json')}</TabsTrigger>
      </TabsList>
      <TabsContent value="cli" className="mt-2">
        {snippet('cli', cli)}
      </TabsContent>
      <TabsContent value="json" className="mt-2">
        {snippet('json', json)}
      </TabsContent>
    </Tabs>
  );
};
