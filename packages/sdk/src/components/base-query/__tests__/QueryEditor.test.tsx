import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { QueryEditor } from '../QueryEditor';

describe('QueryEditor limit/offset', () => {
  it.each(['limit', 'offset'] as const)('clearing %s unsets it instead of storing 0', (type) => {
    const onChange = vi.fn();
    render(<QueryEditor type={type} query={{ from: 'tblA', [type]: 10 }} onChange={onChange} />);

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(type, undefined);

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '25' } });
    expect(onChange).toHaveBeenLastCalledWith(type, 25);
  });
});
