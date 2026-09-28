// Pronunciation through the browser's speech synthesis (American English).
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let voice = null;

function pickVoice() {
  if (!synth) return;
  const vs = synth.getVoices();
  voice = vs.find(v => v.lang === 'en-US' && /natural|samantha|aria|jenny|google us/i.test(v.name))
    || vs.find(v => v.lang === 'en-US') || vs.find(v => v.lang?.startsWith('en')) || null;
}
if (synth) { pickVoice(); synth.addEventListener?.('voiceschanged', pickVoice); }

export const canSpeak = () => !!synth;

export function speak(text, rate = 0.9) {
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  if (voice) u.voice = voice;
  u.rate = rate;
  synth.speak(u);
}
