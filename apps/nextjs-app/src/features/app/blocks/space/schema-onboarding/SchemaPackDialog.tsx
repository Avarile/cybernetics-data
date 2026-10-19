import { Dialog, DialogContent, DialogTitle } from '@teable/ui-lib/shadcn';
import { Database } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { SchemaPackWizard } from './SchemaPackWizard';

export interface ISchemaPackDialogProps {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Add packs to this base instead of creating a new one. */
  baseId?: string;
  /** Shown beside the title so it is clear which base gains the packs. */
  baseName?: string;
}

/** The same wizard, from Choose onwards, for users past first-run onboarding. */
export const SchemaPackDialog = ({
  spaceId,
  open,
  onOpenChange,
  baseId,
  baseName,
}: ISchemaPackDialogProps) => {
  const { t } = useTranslation('onboarding');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A fixed frame: the wizard scrolls its own body between a pinned header and footer. */}
      <DialogContent className="flex h-[85vh] max-h-[800px] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        {open && (
          <SchemaPackWizard
            spaceId={spaceId}
            mode="dialog"
            baseId={baseId}
            onDone={() => onOpenChange(false)}
            title={
              <div className="flex min-w-0 items-center gap-2">
                <DialogTitle className="shrink-0 text-base">{t('entry.dialogTitle')}</DialogTitle>
                {baseId && baseName && (
                  <span className="flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    <Database className="size-3 shrink-0" />
                    <span className="truncate">{baseName}</span>
                  </span>
                )}
              </div>
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
