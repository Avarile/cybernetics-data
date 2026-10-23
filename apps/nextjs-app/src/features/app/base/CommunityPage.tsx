import { useThemeMode } from '@cybernetics/sdk/hooks';
import Image from 'next/image';
import { Trans, useTranslation } from 'next-i18next';
import { useHelpStore } from '@/features/help';
import { tableConfig } from '@/features/i18n/table.config';

export const CommunityPage = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const themeMode = useThemeMode();
  const isDark = themeMode === 'dark';
  const { setOpen: openHelp } = useHelpStore();
  return (
    <div className="h-full flex-col md:flex">
      <div className="flex h-full flex-1 flex-col gap-2 lg:gap-4">
        <div className="items-center justify-between space-y-2 px-8 pb-2 pt-6 lg:flex">
          <h2 className="text-3xl font-bold tracking-tight">{t('table:welcome.title')}</h2>
        </div>
        <div className="flex h-full min-w-80 flex-col items-center justify-center p-4 ">
          <Image
            src={isDark ? '/images/layout/welcome-dark.png' : '/images/layout/welcome-light.png'}
            alt="No roles available"
            width={240}
            height={240}
          />
          <ul className="my-4 flex max-w-[720px] flex-col items-center justify-center space-y-2 text-center">
            <li className="text-lg font-semibold">{t('table:welcome.emptyTitle')}</li>
            <li>{t('table:welcome.description')}</li>
            <li>
              <Trans
                ns="table"
                i18nKey="welcome.help"
                components={{
                  HelpCenter: (
                    <button
                      type="button"
                      className="cursor-pointer text-blue-500 underline hover:text-blue-700"
                      onClick={() => openHelp(true)}
                    >
                      {t('table:welcome.helpCenter')}
                    </button>
                  ),
                }}
              ></Trans>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};
