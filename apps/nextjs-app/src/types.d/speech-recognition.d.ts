// Browser speech recognition is not in lib.dom.d.ts for every target, and it is
// consumed from more than one module. Both the instance shape and the `Window`
// constructors are declared here exactly once: two modules each augmenting
// `Window` with their own variant is a global declaration-merge conflict, not a
// local concern.

interface ISpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface ISpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  /** Stops at once and drops the result still being heard (stop() delivers it). */
  abort(): void;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onresult: ((ev: ISpeechRecognitionEvent) => void) | null;
  onerror: ((ev: ISpeechRecognitionErrorEvent) => void) | null;
}

interface Window {
  // Optional: absent in browsers without the API, which is what the runtime
  // feature checks in the consuming components rely on.
  SpeechRecognition?: new () => ISpeechRecognition;
  webkitSpeechRecognition?: new () => ISpeechRecognition;
}
