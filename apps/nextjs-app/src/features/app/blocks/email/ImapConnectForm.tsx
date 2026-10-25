import type { HttpError } from '@cybernetics/core';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown } from '@teable/icons';
import type { ICreateImapIntegrationRo, IImapServerRo } from '@teable/openapi';
import { createImapIntegration, testUserIntegrationConnection } from '@teable/openapi';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

interface IServerState {
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
}

// well-known providers, filled in from the address so most people only type a password
const PRESETS: Record<string, { imap: string; smtp: string }> = {
  'gmail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  'googlemail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  'outlook.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'hotmail.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'yahoo.com': { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com' },
  'icloud.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com' },
  'me.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com' },
  'fastmail.com': { imap: 'imap.fastmail.com', smtp: 'smtp.fastmail.com' },
  'qq.com': { imap: 'imap.qq.com', smtp: 'smtp.qq.com' },
  '163.com': { imap: 'imap.163.com', smtp: 'smtp.163.com' },
};

const emptyServer = (port: string): IServerState => ({
  host: '',
  port,
  secure: true,
  username: '',
  password: '',
});

const toServerRo = (server: IServerState) => ({
  host: server.host.trim(),
  port: Number(server.port),
  secure: server.secure,
  username: server.username.trim(),
  password: server.password,
});

const ServerFields = (props: {
  id: string;
  server: IServerState;
  onChange: (server: IServerState) => void;
  passwordHint: string;
  defaultPorts: { tls: string; starttls: string };
}) => {
  const { id, server, onChange, passwordHint, defaultPorts } = props;
  const { t } = useTranslation('common');
  const set = (patch: Partial<IServerState>) => onChange({ ...server, ...patch });
  return (
    <div className="grid grid-cols-6 gap-3">
      <div className="col-span-4 space-y-1">
        <Label htmlFor={`${id}-host`}>{t('emailTable.imap.host')}</Label>
        <Input
          id={`${id}-host`}
          value={server.host}
          onChange={(e) => set({ host: e.target.value })}
        />
      </div>
      <div className="col-span-2 space-y-1">
        <Label htmlFor={`${id}-port`}>{t('emailTable.imap.port')}</Label>
        <Input
          id={`${id}-port`}
          inputMode="numeric"
          value={server.port}
          onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })}
        />
      </div>
      <div className="col-span-3 space-y-1">
        <Label>{t('emailTable.imap.security')}</Label>
        <Select
          value={server.secure ? 'tls' : 'starttls'}
          onValueChange={(value) =>
            set({
              secure: value === 'tls',
              port: value === 'tls' ? defaultPorts.tls : defaultPorts.starttls,
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tls">{t('emailTable.imap.tls')}</SelectItem>
            <SelectItem value="starttls">{t('emailTable.imap.starttls')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-3 space-y-1">
        <Label htmlFor={`${id}-username`}>{t('emailTable.imap.username')}</Label>
        <Input
          id={`${id}-username`}
          autoComplete="off"
          value={server.username}
          onChange={(e) => set({ username: e.target.value })}
        />
      </div>
      <div className="col-span-6 space-y-1">
        <Label htmlFor={`${id}-password`}>{t('emailTable.imap.password')}</Label>
        <Input
          id={`${id}-password`}
          type="password"
          autoComplete="new-password"
          value={server.password}
          onChange={(e) => set({ password: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{passwordHint}</p>
      </div>
    </div>
  );
};

/** Connects an IMAP mailbox, with an optional SMTP server saved for later. */
export const ImapConnectForm = (props: {
  onConnected: (integrationId: string) => void;
  onCancel?: () => void;
}) => {
  const { onConnected, onCancel } = props;
  const { t } = useTranslation('common');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [imap, setImap] = useState<IServerState>(emptyServer('993'));
  const [smtp, setSmtp] = useState<IServerState>(emptyServer('465'));
  const [smtpOpen, setSmtpOpen] = useState(false);
  const [error, setError] = useState('');
  const [testOk, setTestOk] = useState(false);

  const applyPreset = () => {
    const domain = email.split('@')[1]?.trim().toLowerCase();
    const preset = domain ? PRESETS[domain] : undefined;
    const username = email.trim();
    setImap((s) => ({
      ...s,
      host: s.host || preset?.imap || '',
      username: s.username || username,
    }));
    setSmtp((s) => ({
      ...s,
      host: s.host || preset?.smtp || '',
      username: s.username || username,
    }));
  };

  const imapRo = (): IImapServerRo => toServerRo(imap);
  const smtpRo = () => (smtpOpen && smtp.host.trim() ? toServerRo(smtp) : undefined);
  const onError = (err: HttpError) => {
    setTestOk(false);
    setError(err.message);
  };

  const { mutate: test, isPending: testing } = useMutation({
    mutationFn: () => {
      const smtpServer = smtpRo();
      return testUserIntegrationConnection({
        imap: imapRo(),
        ...(smtpServer
          ? { smtp: { ...smtpServer, password: smtpServer.password || imap.password } }
          : {}),
      }).then((res) => res.data);
    },
    onSuccess: (result) => {
      const failure = [
        result.imap && !result.imap.ok && `IMAP: ${result.imap.error}`,
        result.smtp && !result.smtp.ok && `SMTP: ${result.smtp.error}`,
      ].filter(Boolean);
      setError(failure.join(' '));
      setTestOk(failure.length === 0);
    },
    onError,
  });

  const { mutate: connect, isPending: connecting } = useMutation({
    mutationFn: () => {
      const smtpServer = smtpRo();
      const ro: ICreateImapIntegrationRo = {
        email: email.trim(),
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        imap: imapRo(),
        ...(smtpServer
          ? { smtp: { ...smtpServer, password: smtpServer.password || undefined } }
          : {}),
      };
      return createImapIntegration(ro).then((res) => res.data);
    },
    onSuccess: ({ id }) => onConnected(id),
    onError,
  });

  const ready = Boolean(
    email.includes('@') && imap.host.trim() && Number(imap.port) && imap.username && imap.password
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="imap-email">{t('emailTable.imap.email')}</Label>
          <Input
            id="imap-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={applyPreset}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="imap-name">{t('emailTable.imap.displayName')}</Label>
          <Input
            id="imap-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t('emailTable.imap.incoming')}</h4>
        <ServerFields
          id="imap"
          server={imap}
          onChange={(next) => {
            setImap(next);
            setTestOk(false);
          }}
          passwordHint={t('emailTable.imap.passwordHint')}
          defaultPorts={{ tls: '993', starttls: '143' }}
        />
      </div>

      <Collapsible open={smtpOpen} onOpenChange={setSmtpOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 px-0 text-sm font-medium">
            <ChevronDown className={smtpOpen ? 'size-4' : 'size-4 -rotate-90'} />
            {t('emailTable.imap.outgoing')}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <p className="text-xs text-muted-foreground">{t('emailTable.imap.outgoingHint')}</p>
          <ServerFields
            id="smtp"
            server={smtp}
            onChange={(next) => {
              setSmtp(next);
              setTestOk(false);
            }}
            passwordHint={t('emailTable.imap.smtpPasswordHint')}
            defaultPorts={{ tls: '465', starttls: '587' }}
          />
        </CollapsibleContent>
      </Collapsible>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {testOk && !error && <p className="text-sm text-green-600">{t('emailTable.imap.testOk')}</p>}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('emailTable.back')}
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={!ready || testing} onClick={() => test()}>
          {t('emailTable.imap.test')}
        </Button>
        <Button size="sm" disabled={!ready || connecting} onClick={() => connect()}>
          {t('emailTable.imap.connect')}
        </Button>
      </div>
    </div>
  );
};
