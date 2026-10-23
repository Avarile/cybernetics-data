import { MarkdownPreview } from '@cybernetics/sdk';
import { StandaloneViewProvider } from '@cybernetics/sdk/context';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CellFormat, FieldKeyType, FieldType } from '@teable/core';
import type { IFilterSet, ISortItem } from '@teable/core';
import { ArrowUpRight, Code2, Copy, Check, Loader2, MagicAi, Key } from '@teable/icons';
import {
  createAccessToken,
  getFields,
  getRecords,
  getTableById,
  type CreateAccessTokenVo,
  type IQueryBaseRo,
} from '@teable/openapi';
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ScrollArea,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
  ToggleGroup,
  ToggleGroupItem,
} from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { FilterBuilder } from '@/features/app/blocks/setting/query-builder/FilterBuilder';
import { PreviewScript } from '@/features/app/blocks/setting/query-builder/PreviewScript';
import { PreviewTable } from '@/features/app/blocks/setting/query-builder/PreviewTable';
import { SearchBuilder } from '@/features/app/blocks/setting/query-builder/SearchBuilder';
import { OrderByBuilder } from '@/features/app/blocks/setting/query-builder/SortBuilder';
import { ViewBuilder } from '@/features/app/blocks/setting/query-builder/ViewBuilder';
import { CopyButton } from '@/features/app/components/CopyButton';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import type { IBaseResourceTable } from '@/features/app/hooks/useBaseResource';
import { tableConfig } from '@/features/i18n/table.config';
import {
  generateAIContext,
  getLinkOptions,
  type ForeignMap,
  type IFieldInfo,
  type IForeignSample,
} from './ai-context.utils';

// Token Section Component
const TokenSection = ({
  generatedToken,
  isLoading,
  onGenerateToken,
}: {
  generatedToken: CreateAccessTokenVo | null;
  isLoading: boolean;
  onGenerateToken: () => void;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Key className="size-5 text-muted-foreground" />
          <span className="font-medium">Token</span>
        </div>
        <div className="flex items-center gap-2">
          {generatedToken ? (
            <>
              <Input className="w-64 font-mono text-xs" readOnly value={generatedToken.token} />
              <CopyButton
                variant="outline"
                size="sm"
                text={generatedToken.token}
                iconClassName="size-4"
              />
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onGenerateToken}
              disabled={isLoading}
              className="gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('table:toolbar.others.api.generatingToken')}
                </>
              ) : (
                <>
                  <Key className="size-4" />
                  {t('table:toolbar.others.api.generateToken')}
                </>
              )}
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild className="gap-1 text-muted-foreground">
            <Link href="/setting/personal-access-token" target="_blank">
              {t('table:toolbar.others.api.manageToken')}
              <ArrowUpRight className="size-3" />
            </Link>
          </Button>
        </div>
      </div>
      {generatedToken && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('table:toolbar.others.api.tokenInfo', {
            expiry: new Date(generatedToken.expiredTime).toLocaleDateString(),
          })}
        </p>
      )}
    </div>
  );
};

// Advanced Query Builder Panel Component
const AdvancedQueryPanel = ({
  tableId,
  baseId,
  initialViewId,
}: {
  tableId: string;
  baseId: string;
  initialViewId?: string;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [viewId, setViewId] = useState<string | undefined>(initialViewId);
  const [filter, setFilter] = useState<IFilterSet | null>(null);
  const [fieldKeyType, setFieldKeyType] = useState<FieldKeyType>(FieldKeyType.Name);
  const [cellFormat, setCellFormat] = useState<CellFormat>(CellFormat.Json);
  const [orderBy, setOrderBy] = useState<ISortItem[]>();
  const [search, setSearch] = useState<IQueryBaseRo['search']>();

  const query = useMemo(
    () => ({
      fieldKeyType,
      viewId,
      filter,
      orderBy,
      search,
      cellFormat,
    }),
    [fieldKeyType, viewId, filter, orderBy, search, cellFormat]
  );

  return (
    <StandaloneViewProvider baseId={baseId} tableId={tableId} viewId={viewId}>
      <div className="space-y-4">
        {/* Introduction */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-medium">{t('table:toolbar.others.api.queryBuilderTitle')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('table:toolbar.others.api.queryBuilderDesc')}
              </p>
            </div>
            <Button variant="outline" size="sm" asChild className="shrink-0 gap-1">
              <Link href={t('common:help.apiLink')} target="_blank">
                {t('table:toolbar.others.api.viewApiDocs')}
                <ArrowUpRight className="size-3" />
              </Link>
            </Button>
          </div>
        </div>

        {/* View & Search */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t('common:noun.view')}</label>
            <ViewBuilder viewId={viewId} onChange={setViewId} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t('common:actions.search')}</label>
            <SearchBuilder search={search} onChange={setSearch} />
          </div>
        </div>

        {/* Filter */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">{t('sdk:filter.label')}</label>
          <FilterBuilder filter={filter} onChange={setFilter} />
        </div>

        {/* Sort */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">{t('sdk:sort.label')}</label>
          <OrderByBuilder orderBy={orderBy} onChange={setOrderBy} />
        </div>

        {/* Format Options */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t('developer:cellFormat')}</label>
            <ToggleGroup
              className="w-auto justify-start"
              variant="outline"
              type="single"
              size="sm"
              value={cellFormat}
              onValueChange={(v) => setCellFormat((v as CellFormat) || CellFormat.Json)}
            >
              <ToggleGroupItem value="json">JSON</ToggleGroupItem>
              <ToggleGroupItem value="text">Text</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t('developer:fieldKeyType')}</label>
            <ToggleGroup
              className="w-auto justify-start"
              variant="outline"
              type="single"
              size="sm"
              value={fieldKeyType}
              onValueChange={(v) => setFieldKeyType((v as FieldKeyType) || FieldKeyType.Name)}
            >
              <ToggleGroupItem value="name">name</ToggleGroupItem>
              <ToggleGroupItem value="id">id</ToggleGroupItem>
              <ToggleGroupItem value="dbFieldName">dbFieldName</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        {/* Preview Script */}
        <div className="border-t pt-4">
          <h3 className="mb-4 text-sm font-medium">{t('developer:buildResult')}</h3>
          <PreviewScript tableId={tableId} query={query} />
        </div>

        {/* Preview Return Value */}
        <div className="border-t pt-4">
          <h3 className="mb-4 text-sm font-medium">{t('developer:previewReturnValue')}</h3>
          <PreviewTable query={query} />
        </div>

        {/* Open in new tab link */}
        <div className="flex justify-end border-t pt-4">
          <Button variant="ghost" size="sm" asChild className="gap-1 text-muted-foreground">
            <Link
              href={`/developer/tool/query-builder?baseId=${baseId}&tableId=${tableId}`}
              target="_blank"
            >
              {t('table:toolbar.others.api.openInNewTab')}
              <ArrowUpRight className="size-3" />
            </Link>
          </Button>
        </div>
      </div>
    </StandaloneViewProvider>
  );
};

export interface APIDialogContentProps {
  onOpenChange: (open: boolean) => void;
}

export const APIDialogContent = ({ onOpenChange: _onOpenChange }: APIDialogContentProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { baseId, tableId, viewId } = useBaseResource() as IBaseResourceTable;
  const [copied, setCopied] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const [generatedToken, setGeneratedToken] = useState<CreateAccessTokenVo | null>(null);
  const [showTokenConfirm, setShowTokenConfirm] = useState(false);

  useEffect(() => {
    setCurrentUrl(window.location.origin);
  }, []);

  // Fetch table info
  const { data: tableInfo } = useQuery({
    queryKey: ['table-info-api-dialog', baseId, tableId],
    queryFn: () => getTableById(baseId, tableId).then((res) => res.data),
    enabled: Boolean(tableId) && Boolean(baseId),
  });

  // Fetch fields
  const { data: fieldsData } = useQuery({
    queryKey: ['fields-api-dialog', tableId],
    queryFn: () => getFields(tableId).then((res) => res.data),
    enabled: Boolean(tableId),
  });

  // Create token mutation
  const createTokenMutation = useMutation({
    mutationFn: async () => {
      const expiredTime = new Date();
      expiredTime.setFullYear(expiredTime.getFullYear() + 1);

      return createAccessToken({
        name: `API Token for ${tableInfo?.name || 'Table'} (Auto-generated)`,
        description: `Auto-generated token for AI integration. Base: ${baseId}, Table: ${tableId}`,
        scopes: [
          'table|read',
          'field|read',
          'record|read',
          'record|create',
          'record|update',
          'record|delete',
        ],
        baseIds: [baseId],
        expiredTime: expiredTime.toISOString(),
      });
    },
    onSuccess: (res) => {
      setGeneratedToken(res.data);
    },
  });

  const handleConfirmCreateToken = useCallback(() => {
    setShowTokenConfirm(false);
    createTokenMutation.mutate();
  }, [createTokenMutation]);

  const fields: IFieldInfo[] = useMemo(() => {
    if (!fieldsData) return [];
    return fieldsData.map((field) => ({
      id: field.id,
      name: field.name,
      type: field.type,
      description: field.description,
      options: field.options,
      isPrimary: field.isPrimary,
      isComputed: field.isComputed,
    }));
  }, [fieldsData]);

  // Distinct foreign tables referenced by this table's link fields.
  const foreignTableIds = useMemo(() => {
    const ids = fields
      .filter((f) => (f.type as FieldType) === FieldType.Link)
      .map((f) => getLinkOptions(f.options).foreignTableId)
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids));
  }, [fields]);

  // Fetch a couple of real records (and the name) from each referenced table so
  // link references in the example record are concrete and copy-paste runnable.
  const { data: foreignMap = {} } = useQuery<ForeignMap>({
    queryKey: ['api-dialog-foreign-samples', baseId, foreignTableIds],
    queryFn: async () => {
      const entries = await Promise.all(
        foreignTableIds.map(async (ftId) => {
          const [recordsRes, tableRes] = await Promise.all([
            getRecords(ftId, { take: 2, fieldKeyType: FieldKeyType.Name }).then((r) => r.data),
            getTableById(baseId, ftId)
              .then((r) => r.data)
              .catch(() => undefined),
          ]);
          const samples: IForeignSample[] = recordsRes.records.map((rec) => ({
            id: rec.id,
            title: rec.name || rec.id,
          }));
          return [ftId, { tableName: tableRes?.name ?? ftId, samples }] as const;
        })
      );
      return Object.fromEntries(entries);
    },
    enabled: Boolean(baseId) && foreignTableIds.length > 0,
  });

  const aiContext = useMemo(() => {
    if (!tableInfo) return '';
    return generateAIContext(
      tableInfo.name,
      tableInfo.description,
      fields,
      currentUrl,
      tableId,
      foreignMap,
      generatedToken?.token
    );
  }, [tableInfo, fields, currentUrl, tableId, foreignMap, generatedToken]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(aiContext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [aiContext]);

  const isLoading = createTokenMutation.isPending;
  const isDataLoading = !tableInfo || !fieldsData;

  return (
    <Tabs defaultValue="ai-context" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="mb-4 w-fit">
        <TabsTrigger value="ai-context" className="gap-2">
          <MagicAi className="size-4" />
          {t('table:toolbar.others.api.aiContext')}
        </TabsTrigger>
        <TabsTrigger value="advanced" className="gap-2">
          <Code2 className="size-4" />
          {t('table:toolbar.others.api.advanced')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="ai-context" className="mt-0 flex min-h-0 flex-1 flex-col">
        {isDataLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">{t('common:actions.loading')}</span>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            {/* Token Section */}
            <TokenSection
              generatedToken={generatedToken}
              isLoading={isLoading}
              onGenerateToken={() => setShowTokenConfirm(true)}
            />

            {/* AI Document Preview */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="mb-2 flex shrink-0 items-center justify-between">
                <span className="text-sm font-medium">
                  {t('table:toolbar.others.api.aiDocPreview')}
                </span>
                <Button onClick={handleCopy} size="sm" className="gap-2">
                  {copied ? (
                    <>
                      <Check className="size-4" />
                      {t('table:toolbar.others.api.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" />
                      {t('table:toolbar.others.api.copyAIDoc')}
                    </>
                  )}
                </Button>
              </div>
              <ScrollArea className="min-h-0 flex-1 rounded-lg border bg-muted/20 p-4">
                <MarkdownPreview>{aiContext}</MarkdownPreview>
              </ScrollArea>
            </div>
          </div>
        )}

        {/* Token Creation Confirmation Dialog */}
        <AlertDialog open={showTokenConfirm} onOpenChange={setShowTokenConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('table:toolbar.others.api.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription className="space-y-3">
                <p>{t('table:toolbar.others.api.confirmDescription')}</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>{t('table:toolbar.others.api.scopeTableRead')}</li>
                  <li>{t('table:toolbar.others.api.scopeFieldRead')}</li>
                  <li>{t('table:toolbar.others.api.scopeRead')}</li>
                  <li>{t('table:toolbar.others.api.scopeCreate')}</li>
                  <li>{t('table:toolbar.others.api.scopeUpdate')}</li>
                  <li>{t('table:toolbar.others.api.scopeDelete')}</li>
                </ul>
                <p>{t('table:toolbar.others.api.confirmExpiry')}</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmCreateToken}>
                {t('table:toolbar.others.api.confirmButton')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TabsContent>

      <TabsContent value="advanced" className="mt-0 min-h-0 flex-1 overflow-auto">
        <ScrollArea className="h-full">
          <AdvancedQueryPanel tableId={tableId} baseId={baseId} initialViewId={viewId} />
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
};
