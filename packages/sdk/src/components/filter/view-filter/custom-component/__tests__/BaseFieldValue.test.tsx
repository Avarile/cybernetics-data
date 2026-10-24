import type { IFilterItem } from '@cybernetics/core';
import { render } from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';
import { createAppContext } from '../../../../../context/__tests__/createAppContext';
import { BaseFieldValue } from '../BaseFieldValue';

describe('BaseFieldValue', () => {
  it('clears a stored value for an empty operator without updating the parent during render', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onValue = vi.fn();

    const Parent = () => {
      const [value, setValue] = useState<IFilterItem['value']>('leftover');
      onValue(value);
      // a new onSelect every render, like FieldValue passes
      return <BaseFieldValue value={value} operator="isEmpty" onSelect={(v) => setValue(v)} />;
    };
    render(<Parent />, { wrapper: createAppContext() });

    expect(onValue).toHaveBeenLastCalledWith(null);
    const renderPhaseUpdate = consoleError.mock.calls.some((args) =>
      String(args[0]).includes('Cannot update a component')
    );
    expect(renderPhaseUpdate).toBe(false);
    consoleError.mockRestore();
  });
});
