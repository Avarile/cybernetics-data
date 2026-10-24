import { useEffect, useState } from 'react';
import type { IPluginBridgeOptions } from '../bridge';
import { PluginBridge } from '../bridge';
import type { IPluginBridge } from '../types';

// One connection to the host shared by every consumer, destroyed when the last one unmounts
type ISharedBridge = {
  pluginBridge: PluginBridge;
  promise: Promise<IPluginBridge>;
  bridge?: IPluginBridge;
};
let sharedBridge: ISharedBridge | undefined;
let consumerCount = 0;

const acquireBridge = (options?: IPluginBridgeOptions) => {
  consumerCount += 1;
  if (!sharedBridge) {
    const pluginBridge = new PluginBridge(options);
    const shared: ISharedBridge = {
      pluginBridge,
      promise: pluginBridge.init().then((bridge) => {
        shared.bridge = bridge;
        return bridge;
      }),
    };
    sharedBridge = shared;
  }
  return sharedBridge;
};

const releaseBridge = () => {
  consumerCount -= 1;
  if (consumerCount > 0 || !sharedBridge) {
    return;
  }
  sharedBridge.pluginBridge.destroy();
  sharedBridge = undefined;
};

/**
 * @param options only applied by the consumer that creates the shared connection
 */
export const usePluginBridge = (options?: IPluginBridgeOptions) => {
  const [bridge, setBridge] = useState<IPluginBridge | undefined>(sharedBridge?.bridge);

  useEffect(() => {
    let active = true;
    const shared = acquireBridge(options);
    shared.promise.then(
      (bridge) => active && setBridge(bridge),
      (error) => active && console.error('[usePluginBridge] Failed to connect to host:', error)
    );
    return () => {
      active = false;
      setBridge(undefined);
      releaseBridge();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return bridge;
};
