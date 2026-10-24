import type { IUserFieldOptions } from '@teable/core';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserEditor } from './Editor';

vi.mock('./EditorMain', () => ({
  UserEditorMain: () => null,
}));

const value = [{ id: 'usr_1', title: 'Alice' }];
const options = { isMultiple: true } as IUserFieldOptions;

describe('UserEditor', () => {
  it('hides the remove icon when readonly', () => {
    const { container } = render(<UserEditor value={value} options={options} readonly />);

    expect(container.querySelector('svg.cursor-pointer')).toBeNull();
  });

  it('shows the remove icon when editable', () => {
    const { container } = render(<UserEditor value={value} options={options} />);

    expect(container.querySelector('svg.cursor-pointer')).not.toBeNull();
  });
});
