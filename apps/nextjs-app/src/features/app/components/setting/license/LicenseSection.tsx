import { ArrowUpRight, Teable } from '@teable/icons';
import { Trans, useTranslation } from 'next-i18next';
import { SettingTabHeader, SettingTabShell } from '../SettingTabShell';

// Required by the upstream Teable license (AGPL-3.0 §13 source offer + §7(e) brand terms)
const TEABLE_URL = 'https://github.com/teableio/teable';
const SOURCE_CODE_URL = 'https://github.com/Avarile/cybernetics-data';

export const LicenseSection = () => {
  const { t } = useTranslation(['setting', 'common']);

  return (
    <SettingTabShell
      header={
        <SettingTabHeader
          title={t('setting:license')}
          description={t('setting:licenseDescription')}
        />
      }
    >
      <div className="flex flex-col divide-y rounded-lg border text-sm">
        <div className="flex items-center gap-1 p-4">
          <Trans
            ns="common"
            i18nKey="poweredBy"
            components={[
              <a
                key="teable"
                href={TEABLE_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 font-semibold hover:underline"
              >
                <Teable className="size-4" />
                Teable
                <ArrowUpRight className="size-3.5 text-muted-foreground" />
              </a>,
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-4 p-4">
          <span>{t('common:sourceCode')}</span>
          <a
            href={SOURCE_CODE_URL}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
          >
            <span className="truncate">{SOURCE_CODE_URL.replace('https://', '')}</span>
            <ArrowUpRight className="size-3.5 shrink-0" />
          </a>
        </div>
      </div>
    </SettingTabShell>
  );
};
