import { useSession } from '@cybernetics/sdk/hooks';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDeepLink, useToggleKey } from '../hooks/useCockpitKeys';
import { useCockpitStore } from '../state/cockpit-store';
import { AgentCockpit } from './AgentCockpit';

/**
 * Mounted once by each signed-in layout: the cockpit for admins, its shortcut and deep links
 * (cockpit design §4.4). Off unmounts the screen only; the conversation lives in the session
 * store and keeps going.
 */
export const AgentCockpitHost = () => {
  const isAdmin = Boolean(useSession().user?.isAdmin);
  const on = useCockpitStore((s) => s.on);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useToggleKey(isAdmin);
  useDeepLink(isAdmin);
  if (!isAdmin || !on || !mounted) return null;
  return createPortal(<AgentCockpit />, document.body);
};
