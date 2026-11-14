import { useCallback, useRef, useState } from 'react';
import { playReaction, pickReaction } from '../lib/reactions';

interface SpeechParams {
  pitch: number;
  rate: number;
}

const FEMALE_VOICES = [
  'Google UK English Female', 'Microsoft Zira', 'Samantha', 'Google US English',
  'Karen', 'Tessa', 'Fiona',
];
const MALE_VOICES = [
  'Google UK English Male', 'Microsoft David', 'Daniel', 'Alex',
  'Google US English', 'Tom', 'Rishi',
];

function pickVoice(gender: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const prefs = gender === 'female' ? FEMALE_VOICES : gender === 'male' ? MALE_VOICES : [...MALE_VOICES, ...FEMALE_VOICES];
  for (const name of prefs) {
    const v = voices.find((vc) => vc.name === name);
    if (v) return v;
  }
  return voices.find((v) => v.lang.startsWith('en')) || voices[0] || null;
}

export interface RoastLine {
  text: string;
  gender: string;
  speech: { pitch: number; rate: number };
  phase?: string;
  persona_id?: string;
  line?: string;
}

export function useVoicePlayer() {
  const [activeIdx, setActiveIdx] = useState(-1);
  const [speaking, setSpeaking] = useState(false);
  const [highlightLine, setHighlightLine] = useState<string | null>(null);
  const stopRef = useRef(false);

  const stop = useCallback(() => {
    stopRef.current = true;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
    setActiveIdx(-1);
    setHighlightLine(null);
  }, []);

  const playLine = useCallback((text: string, gender: string, params: SpeechParams) => {
    return new Promise<void>((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        setTimeout(resolve, Math.max(1500, text.length * 50));
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const voice = pickVoice(gender, voices);
      if (voice) utter.voice = voice;
      utter.pitch = Math.max(0, Math.min(2, params.pitch));
      utter.rate = Math.max(0.5, Math.min(2, params.rate));
      utter.volume = 1;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
  }, []);

  const playSequence = useCallback(
    async (
      lines: RoastLine[],
      onIndex: (i: number) => void,
      // Kept in the public signature for callers; SFX now come from lib/reactions.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      onSfx?: (name: string) => void
    ) => {
      stopRef.current = false;
      setSpeaking(true);

      // OPEN: Host reaction for the intro
      if (lines[0]?.phase === 'open') {
        playReaction('host-reaction', 0.5);
      }

      for (let i = 0; i < lines.length; i++) {
        if (stopRef.current) break;
        setActiveIdx(i);
        setHighlightLine(lines[i].text);
        onIndex(i);

        // Play the line
        await playLine(lines[i].text, lines[i].gender, lines[i].speech);

        if (stopRef.current) break;

        // Smart reaction after each line
        const reaction = pickReaction(lines[i].text, lines[i].phase || 'observation');
        playReaction(reaction, 0.4);

        // Timing: pause based on phase
        let pause = 500;
        if (lines[i].phase === 'open') pause = 800;
        else if (lines[i].phase === 'finale') pause = 1000;
        else if (reaction === 'delayed-laugh') pause = 700;
        else if (reaction === 'big-laugh') pause = 600;

        await new Promise((r) => setTimeout(r, pause));
      }

      // FINALE: crowd pop at the end
      if (!stopRef.current) {
        playReaction('crowd-pop', 0.6);
      }
      setSpeaking(false);
      setActiveIdx(-1);
      setHighlightLine(null);
    },
    [playLine]
  );

  return { activeIdx, speaking, highlightLine, playSequence, stop };
}
