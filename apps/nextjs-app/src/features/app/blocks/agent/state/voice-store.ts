import { LocalStorageKeys } from '@cybernetics/sdk/config';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { IEngineChoice } from '../model/voice';

interface IAgentVoiceState {
  /**
   * Voice conversation on. Not kept across reloads (voice design D8): the mic and the audio need
   * a fresh click. It survives thread switches and `/clear`, which remount the chat.
   */
  enabled: boolean;
  /** Who speaks the replies; kept per browser (D11, D12). */
  engine: IEngineChoice;
  /** The browser voice the admin picked; voices differ per machine, so it is kept per browser. */
  browserVoiceURI?: string;
  setEnabled: (enabled: boolean) => void;
  setEngine: (engine: IEngineChoice) => void;
  setBrowserVoice: (voiceURI?: string) => void;
}

export const useAgentVoiceStore = create<IAgentVoiceState>()(
  persist(
    (set) => ({
      enabled: false,
      engine: 'auto',
      browserVoiceURI: undefined,
      setEnabled: (enabled) => set({ enabled }),
      setEngine: (engine) => set({ engine }),
      setBrowserVoice: (browserVoiceURI) => set({ browserVoiceURI }),
    }),
    {
      name: LocalStorageKeys.AgentVoice,
      partialize: (state) => ({ engine: state.engine, browserVoiceURI: state.browserVoiceURI }),
    }
  )
);
