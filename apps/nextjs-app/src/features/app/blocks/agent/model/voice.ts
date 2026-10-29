/** Who speaks the agent's replies (voice design §6.6). */
export type IEngineId = 'elevenlabs' | 'browser';
/** The admin's choice in the voice settings (voice design §6.6, D11). */
export type IEngineChoice = 'auto' | IEngineId;
