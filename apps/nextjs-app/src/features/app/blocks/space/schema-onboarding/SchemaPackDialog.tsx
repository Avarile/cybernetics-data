import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { SchemaPackWizard } from './SchemaPackWizard';

export interface ISchemaPackDialogProps {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Add packs to this base instead of creating a new one. */
  baseId?: string;
}

/** The same wizard, from Choose onwards, for users past first-run onboarding. */
export const SchemaPackDialog = ({
  spaceId,
  open,
  onOpenChange,
  baseId,
}: ISchemaPackDialogProps) => {
  const { t } = useTranslation('onboarding');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-6xl flex-col overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-5">
          <DialogTitle>{t('entry.dialogTitle')}</DialogTitle>
        </DialogHeader>
        {open && (
          <SchemaPackWizard
            spaceId={spaceId}
            mode="dialog"
            baseId={baseId}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
