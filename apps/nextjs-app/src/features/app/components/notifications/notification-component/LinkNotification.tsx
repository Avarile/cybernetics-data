import { NotificationTypeEnum } from '@cybernetics/core';
import type { ILocalization, NotificationStatesEnum } from '@cybernetics/core';
import { getLocalizationMessage } from '@cybernetics/sdk/context';
import type { ILocaleFunction } from '@cybernetics/sdk/context/app/i18n';
import { type INotificationVo } from '@teable/openapi';
import { escape, mapValues } from 'lodash';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

interface LinkNotificationProps {
  data: INotificationVo['notifications'][number];
  notifyStatus: NotificationStatesEnum;
}

/**
 * The result is rendered as HTML. Only the translation templates may carry markup (links in
 * import/export notices); plain messages and interpolated values hold user, table and field
 * names, so they are escaped. i18next does not escape them here (escapeValue is false).
 */
const getShowMessage = (data: INotificationVo['notifications'][number], t: ILocaleFunction) => {
  const { message, messageI18n } = data;
  try {
    if (!messageI18n) {
      return escape(message);
    }
    const parsedMessage = JSON.parse(messageI18n);
    const { i18nKey = '', context = {} } = parsedMessage as ILocalization;
    if (!i18nKey) {
      return escape(message);
    }
    const safeContext = mapValues(context, (value) =>
      typeof value === 'string' ? escape(value) : value
    );
    return getLocalizationMessage(
      { i18nKey, context: { spaceName: '', ...safeContext } },
      t,
      'common'
    );
  } catch (error) {
    return escape(message);
  }
};

export const LinkNotification = (props: LinkNotificationProps) => {
  const {
    data,
    data: { url, notifyType },
  } = props;

  const { t } = useTranslation(['common']);
  const message = getShowMessage(data, t as ILocaleFunction);

  // When the message contains inner <a> links (e.g. error report download),
  // we need to stop the click from bubbling up to the parent <Link> which
  // would navigate to the table URL instead.
  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' || target.closest('a')) {
      e.stopPropagation();
      e.preventDefault();
      const anchor = (target.tagName === 'A' ? target : target.closest('a')) as HTMLAnchorElement;
      if (anchor?.href) {
        window.open(anchor.href, anchor.target || '_blank', 'noopener,noreferrer');
      }
    }
  };

  return notifyType !== NotificationTypeEnum.ExportBase ? (
    <Link href={url}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="max-h-20 overflow-auto break-words"
        dangerouslySetInnerHTML={{ __html: message }}
        onClick={handleContentClick}
      />
    </Link>
  ) : (
    <>
      <div
        className="max-h-20 overflow-auto break-words"
        dangerouslySetInnerHTML={{ __html: message }}
      />
      {/* do not delete this div for tailwind css */}
      <div className="hidden underline hover:text-blue-500"></div>
    </>
  );
};
