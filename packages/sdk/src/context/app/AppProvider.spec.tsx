import { render } from '@testing-library/react';
import { useContext } from 'react';
import { AppContext } from './AppContext';
import { AppProvider } from './AppProvider';
import { defaultLocale } from './i18n';

describe('AppProvider', () => {
  it('merges a custom locale without mutating the default locale', () => {
    const originalCancel = defaultLocale.common.cancel;
    let contextLocale: unknown;
    const Consumer = () => {
      contextLocale = useContext(AppContext).locale;
      return null;
    };

    render(
      <AppProvider disabledWs locale={{ common: { cancel: 'Custom cancel' } }}>
        <Consumer />
      </AppProvider>
    );

    expect(defaultLocale.common.cancel).toBe(originalCancel);
    expect(contextLocale).not.toBe(defaultLocale);
    expect((contextLocale as typeof defaultLocale).common.cancel).toBe('Custom cancel');
  });
});
