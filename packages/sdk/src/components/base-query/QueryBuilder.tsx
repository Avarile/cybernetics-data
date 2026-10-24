import { X } from '@teable/icons';
import { BaseQueryColumnType, getFields } from '@teable/openapi';
import type { IBaseQueryColumn, IBaseQuery, IBaseQueryJoin } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib';
import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { QuerySortedKeys } from './constant';
import type { IContextColumns } from './context/QueryEditorContext';
import { QueryEditorProvider } from './context/QueryEditorProvider';
import { QueryFormContext } from './context/QueryFormContext';
import { QueryFormProvider } from './context/QueryFormProvider';
import { QueryFrom } from './query-from/QueryFrom';
import { QueryFromTableValue } from './query-from/QueryFromValue';
import { QueryEditorContainer } from './QueryEditorContainer';
import { QueryOperators } from './QueryOperators';

export interface IBaseQueryBuilderRef {
  validateQuery: () => boolean;
  initContext: (query?: IBaseQuery) => void;
}

export const BaseQueryBuilder = forwardRef<
  IBaseQueryBuilderRef,
  {
    className?: string;
    query?: IBaseQuery;
    maxDepth?: number;
    onChange: (query?: IBaseQuery) => void;
  }
>((props, ref) => {
  return (
    <QueryFormProvider>
      <QueryBuilderContainer {...props} ref={ref} />
    </QueryFormProvider>
  );
});

BaseQueryBuilder.displayName = 'QueryBuilder';

// TODO: Refactor this component context generation
const QueryBuilderContainer = forwardRef<
  IBaseQueryBuilderRef,
  {
    className?: string;
    query?: IBaseQuery;
    onChange: (query?: IBaseQuery) => void;
    getContextFromChild?: (context: IBaseQueryColumn[]) => void;
    depth?: number;
    maxDepth?: number;
  }
>((props, ref) => {
  const { className, query, onChange, depth = 0, getContextFromChild, maxDepth = 3 } = props;
  const [fromType, setFromType] = useState<'table' | 'query' | undefined>();
  const [childContext, setChildContext] = useState<IBaseQueryColumn[]>([]);
  const [joinContext, setJoinContext] = useState<IContextColumns>([]);
  const [canSelectedColumnIds, setCanSelectedColumnIds] = useState<string[]>();
  const formQueryRef = useRef<IBaseQueryBuilderRef>(null);
  // latest request per key, so a slow response can't overwrite a newer selection
  const contextRequestIdRef = useRef({ from: 0, join: 0 });
  const { validators } = useContext(QueryFormContext);

  useEffect(() => {
    if (query) {
      if (query.from == undefined) {
        setFromType(undefined);
        return;
      }
      setFromType(
        typeof query.from === 'string' && fromType !== 'query' && query.from ? 'table' : 'query'
      );
    } else {
      setFromType(undefined);
    }
  }, [query, fromType]);

  useImperativeHandle(ref, () => ({
    validateQuery: () => {
      // validate from
      // context validators
      if (formQueryRef.current && !formQueryRef.current.validateQuery()) {
        return false;
      }
      // validate all keys
      if (
        (['from', ...QuerySortedKeys] as const).some(
          (key) => validators[key] && !validators[key]?.()
        )
      )
        return false;

      return true;
    },
    initContext: (innerQuery?: IBaseQuery) => {
      const query = innerQuery || props.query;
      collectContext('from', query?.from);
      collectContext('join', query?.join);
      formQueryRef.current?.initContext(query?.from as IBaseQuery);
    },
  }));

  // derived from the from/join columns so it is never computed against a stale (or empty) context
  const aggregationContext = useMemo(() => {
    if (!query?.aggregation) {
      return [];
    }
    return query.aggregation
      .map((aggregation) => {
        const column = [...joinContext, ...childContext].find(
          (v) => v.column === aggregation.column
        );
        if (!column) return;
        return {
          name: `${column.name}_${aggregation.statisticFunc}`,
          type: column.type,
          column: `${aggregation.column}_${aggregation.statisticFunc}`,
          fieldSource: column.fieldSource,
        };
      })
      .filter(Boolean) as IBaseQueryColumn[];
  }, [query?.aggregation, joinContext, childContext]);

  const hasAggregation = !!query?.aggregation?.length;
  useEffect(() => {
    if (hasAggregation) {
      setCanSelectedColumnIds(query?.groupBy?.map((group) => group.column) || []);
    } else {
      setCanSelectedColumnIds(undefined);
    }
  }, [hasAggregation, query?.groupBy]);

  useEffect(() => {
    if (childContext.length === 0) {
      return getContextFromChild?.([]);
    }
    const aggregationColumns = aggregationContext.map((aggregation) => ({
      column: aggregation.column,
      type: BaseQueryColumnType.Aggregation,
      name: aggregation.name,
    }));
    const allColumns = canSelectedColumnIds
      ? [
          ...childContext.filter(({ column }) => canSelectedColumnIds.includes(column)),
          ...aggregationColumns,
          ...joinContext.filter(({ column }) => canSelectedColumnIds.includes(column)),
        ]
      : [...childContext, ...aggregationColumns, ...joinContext];
    if (!query?.select) {
      return getContextFromChild?.(allColumns);
    }
    const selectCols = query?.select;
    getContextFromChild?.(
      aggregationColumns.concat(
        selectCols
          .map((selectCol) => allColumns.find((v) => v.column === selectCol.column))
          .filter(Boolean) as IBaseQueryColumn[]
      )
    );
  }, [
    aggregationContext,
    childContext,
    getContextFromChild,
    joinContext,
    query?.select,
    canSelectedColumnIds,
  ]);

  const getContextWithTableIds = async (tableIds: string[]) => {
    const tableFields = await Promise.all(
      tableIds.map((tableId) => getFields(tableId).then((res) => res.data))
    );
    return tableFields.map((fields) =>
      fields.map(
        (field) =>
          ({
            column: field.id,
            type: BaseQueryColumnType.Field,
            name: field.name,
            fieldSource: field,
          }) as IBaseQueryColumn
      )
    );
  };

  const collectContext = async <T extends keyof IBaseQuery>(key: T, value?: IBaseQuery[T]) => {
    switch (key) {
      case 'join':
        {
          const requestId = ++contextRequestIdRef.current.join;
          if (!value) {
            return setJoinContext([]);
          }
          const join = value as IBaseQueryJoin[];
          const tableIds = join.map((v) => v.table).filter((v) => !!v) as string[];
          const tablesContext = await getContextWithTableIds(tableIds);
          if (requestId !== contextRequestIdRef.current.join) {
            return;
          }
          setJoinContext(
            tablesContext
              .map((context, i) =>
                context.map((v) => ({
                  ...v,
                  groupTableId: tableIds[i],
                }))
              )
              .flat()
          );
        }
        break;
      case 'from':
        {
          const requestId = ++contextRequestIdRef.current.from;
          if (!value) {
            setChildContext([]);
            return;
          }
          if (typeof value === 'string') {
            const context = await getContextWithTableIds([value]);
            if (requestId !== contextRequestIdRef.current.from) {
              return;
            }
            setChildContext(context.flat());
          }
        }
        break;
    }
  };

  const onQueryChange = async <T extends keyof IBaseQuery>(key: T, value: IBaseQuery[T]) => {
    collectContext(key, value);
    if (!query) {
      key === 'from' &&
        onChange({
          from: value as IBaseQuery['from'],
        });
      return;
    }
    onChange({
      ...query,
      [key]: value,
    });
  };

  const handleGetContextFromChild = useCallback((childContext: IBaseQueryColumn[]) => {
    setChildContext(childContext);
  }, []);

  const providerContextColumns = useMemo(() => {
    return {
      from: childContext,
      join: joinContext,
    };
  }, [childContext, joinContext]);

  const onFromChange = async (type: string, tableId?: string) => {
    if (type === 'query') {
      onQueryChange('from', '');
      setFromType('query');
      return;
    }
    if (tableId) {
      onQueryChange('from', tableId);
      setFromType('table');
      return;
    }
    // if tableId is undefined, clear from
    if (!tableId) {
      setFromType(undefined);
      onChange(undefined);
      return;
    }
    setFromType(undefined);
    onQueryChange('from', '');
  };

  const onFromQueryChange = (query?: IBaseQuery) => {
    if (!query) {
      setChildContext([]);
      setFromType(undefined);
      // if tableId is undefined, clear from
      onChange(undefined);
      return;
    }
    onQueryChange('from', query ?? '');
  };

  return (
    <div className={cn('relative rounded border py-4 px-2', className)}>
      {depth > 0 && (
        <Button
          className="absolute right-1 top-1 h-auto rounded-full p-0.5 text-[13px]"
          size={'xs'}
          variant={'outline'}
          onClick={() => onChange(undefined)}
        >
          <X className="size-4 shrink-0" />
        </Button>
      )}
      <QueryFrom addButton={!fromType} maxDepth={maxDepth <= depth + 1} onClick={onFromChange}>
        <QueryFromTableValue
          from={query?.from}
          onChange={(from) => onFromChange('from', from)}
          component={
            fromType === 'query' ? (
              <QueryFormProvider>
                <QueryBuilderContainer
                  ref={formQueryRef}
                  className="py-6"
                  query={query?.from as IBaseQuery}
                  onChange={onFromQueryChange}
                  depth={depth + 1}
                  maxDepth={maxDepth}
                  getContextFromChild={handleGetContextFromChild}
                />
              </QueryFormProvider>
            ) : undefined
          }
        />
      </QueryFrom>
      {query?.from && (
        <QueryEditorProvider
          columns={providerContextColumns}
          canSelectedColumnIds={canSelectedColumnIds}
          defaultStatus={{
            join: !!query?.join,
            limit: !!query?.limit,
            where: !!query?.where,
            offset: !!query?.offset,
            select: !!query?.select,
            groupBy: !!query?.groupBy,
            orderBy: !!query?.orderBy,
            aggregation: !!query?.aggregation,
          }}
        >
          <QueryOperators />
          <QueryEditorContainer query={query!} onChange={onQueryChange} />
        </QueryEditorProvider>
      )}
    </div>
  );
});

QueryBuilderContainer.displayName = 'QueryBuilderContainer';
