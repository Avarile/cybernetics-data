import { NotificationStatesEnum, NotificationTypeEnum } from '@cybernetics/core';
import type { INotificationVo } from '@teable/openapi';
import { render } from '@testing-library/react';
import i18next from 'i18next';
import { LinkNotification } from './LinkNotification';

// Same interpolation setting the app runs with: next-i18next defaults escapeValue to false.
const i18n = i18next.createInstance();
void i18n.init({
  lng: 'en',
  initImmediate: false,
  interpolation: { escapeValue: false },
  resources: {
    en: {
      common: {
        notify: {
          withLink: 'Import of {{tableName}} failed. <a href="{{errorReportUrl}}">Report</a>',
        },
      },
    },
  },
});

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: i18n.t.bind(i18n) }),
}));

type INotification = INotificationVo['notifications'][number];

const PAYLOAD = '<img src=x onerror="window.__xss=1">';

const renderNotification = (data: Partial<INotification>) =>
  render(
    <LinkNotification
      data={
        {
          id: 'notTest',
          notifyType: NotificationTypeEnum.System,
          url: '/base/bseTest',
          message: '',
          messageI18n: null,
          isRead: false,
          createdTime: '2026-10-26T00:00:00.000Z',
          ...data,
        } as INotification
      }
      notifyStatus={NotificationStatesEnum.Unread}
    />
  );

describe('LinkNotification', () => {
  it('escapes interpolated values but keeps the template markup', () => {
    const { container } = renderNotification({
      messageI18n: JSON.stringify({
        i18nKey: 'notify.withLink',
        context: { tableName: PAYLOAD, errorReportUrl: '/report?a=1&b="2"' },
      }),
    });

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain(PAYLOAD);
    const link = container.querySelector('a[href^="/report"]');
    expect(link?.getAttribute('href')).toBe('/report?a=1&b="2"');
  });

  it('renders a plain message as text', () => {
    const { container } = renderNotification({ message: `Email sync for "${PAYLOAD}" stopped` });

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe(`Email sync for "${PAYLOAD}" stopped`);
  });
});
