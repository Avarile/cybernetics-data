import { FieldType, NumberFormattingType } from '@teable/core';
import { render } from '@testing-library/react';
import { forwardRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IFieldInstance } from '../../model';
import { CellEditorMain } from './CellEditorMain';

const editorProps = vi.hoisted(() => ({ number: {}, select: {} }) as Record<string, unknown>);

vi.mock('../../hooks', () => ({
  useTableId: () => 'tbl_test',
}));

vi.mock('../editor', () => {
  const recordProps = (name: string) => {
    const Editor = forwardRef((props: Record<string, unknown>, _ref) => {
      editorProps[name] = props;
      return null;
    });
    Editor.displayName = name;
    return Editor;
  };
  return {
    NumberEditor: recordProps('number'),
    SelectEditor: recordProps('select'),
  };
});

const createField = (field: Record<string, unknown>) =>
  ({ id: 'fld_test', ...field }) as unknown as IFieldInstance;

describe('CellEditorMain', () => {
  beforeEach(() => {
    editorProps.number = {};
    editorProps.select = {};
  });

  it('passes the number formatting to NumberEditor', () => {
    const formatting = { type: NumberFormattingType.Percent, precision: 2 };
    render(
      <CellEditorMain
        field={createField({ type: FieldType.Number, options: { formatting } })}
        cellValue={0.25}
      />
    );

    expect((editorProps.number as { formatting?: unknown }).formatting).toEqual(formatting);
  });

  it('passes preventAutoNewOptions to the multiple select editor', () => {
    render(
      <CellEditorMain
        field={createField({
          type: FieldType.MultipleSelect,
          options: { choices: [], preventAutoNewOptions: true },
        })}
        cellValue={[]}
      />
    );

    expect(editorProps.select).toMatchObject({ isMultiple: true, preventAutoNewOptions: true });
  });
});
