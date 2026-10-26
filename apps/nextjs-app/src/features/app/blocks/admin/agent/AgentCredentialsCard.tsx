import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IAgentCredentialVo } from '@teable/openapi';
import {
  deleteAgentCredentialSecret,
  listAgentCredentials,
  setAgentCredentialSecret,
  testAgentCredential,
} from '@teable/openapi';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';

/** Enter a secret; it goes to the vault and is never shown again (design D4). */
const SecretDialog = ({
  credential,
  onClose,
  onSaved,
}: {
  credential: IAgentCredentialVo | null;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const { t } = useTranslation('common');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(''), [credential?.id]);
  const save = async () => {
    if (!credential || !value) return;
    setSaving(true);
    try {
      await setAgentCredentialSecret(credential.id, { value });
      setValue('');
      onSaved();
      onClose();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={credential !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('agent.admin.setSecret', 'Set secret')}: {credential?.name}
          </DialogTitle>
          <DialogDescription>
            {t('agent.admin.setSecretHelp', 'Stored encrypted and only ever sent to')}{' '}
            {credential?.allowedHosts.join(', ')}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="agent-secret">{t('agent.admin.secret', 'Secret')}</Label>
          <Input
            id="agent-secret"
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('actions.cancel', 'Cancel')}
          </Button>
          <Button disabled={!value || saving} onClick={() => void save()}>
            {t('actions.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** Credentials the agent may use: metadata only, never the secret (design §8, D4). */
export const AgentCredentialsCard = () => {
  const { t } = useTranslation('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['agent', 'credentials'], queryFn: listAgentCredentials });
  const credentials = useMemo(() => data?.credentials ?? [], [data]);
  const [editing, setEditing] = useState<IAgentCredentialVo | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['agent', 'credentials'] });

  // the link credential_request gives the admin: /admin/agent?credential=<id>
  const linked = typeof router.query.credential === 'string' ? router.query.credential : undefined;
  const openedLink = useRef<string>();
  useEffect(() => {
    const target = credentials.find((c) => c.id === linked);
    // open once per link, not again after every refetch
    if (!target || openedLink.current === target.id) return;
    openedLink.current = target.id;
    document.getElementById(`credential-${target.id}`)?.scrollIntoView({ block: 'center' });
    setEditing(target);
  }, [linked, credentials]);

  const test = async (c: IAgentCredentialVo) => {
    const result = await testAgentCredential(c.id);
    if (result.ok) toast.success(`${c.name}: HTTP ${result.status}`);
    else toast.error(`${c.name}: ${result.error ?? `HTTP ${result.status}`}`);
    refresh();
  };
  const remove = async (c: IAgentCredentialVo) => {
    await deleteAgentCredentialSecret(c.id);
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('agent.admin.credentials', 'Credentials')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t(
            'agent.admin.credentialsHelp',
            'The agent asks for a credential with credential_request; the secret is entered here and is only ever sent to the listed hosts.'
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {credentials.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('agent.admin.noCredentials', 'No credentials yet.')}
          </p>
        )}
        {credentials.map((c) => (
          <div
            key={c.id}
            id={`credential-${c.id}`}
            className="flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-sm"
          >
            <span className="font-medium">{c.name}</span>
            <Badge variant={c.status === 'set' ? 'default' : 'secondary'}>
              {c.status ?? 'missing'}
            </Badge>
            {c.preview && <code className="text-xs text-muted-foreground">{c.preview}</code>}
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {c.allowedHosts.join(', ')} · {c.allowedMethods.join(', ')}
            </span>
            <div className="flex gap-1">
              <Button size="xs" variant="outline" onClick={() => setEditing(c)}>
                {t('agent.admin.setSecret', 'Set secret')}
              </Button>
              {c.status !== 'missing' && (
                <>
                  <Button size="xs" variant="ghost" onClick={() => void test(c)}>
                    {t('agent.admin.test', 'Test')}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => void remove(c)}>
                    {t('agent.admin.removeSecret', 'Remove')}
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent>
      <SecretDialog credential={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </Card>
  );
};
