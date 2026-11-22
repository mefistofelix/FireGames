// Sound effects synthesized with Web Audio: no audio files to download.

let audio = null;

// Browsers start the audio context only after a user gesture; call this from a key or touch handler.
export function unlock() {
  if (!audio) audio = new AudioContext();
  audio.resume();
}

function tone(frequency, delay, duration, type, volume) {
  if (!audio) return;
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

export function chime() {
  tone(659, 0, 0.35, "triangle", 0.25);
  tone(880, 0.12, 0.35, "triangle", 0.25);
  tone(1319, 0.24, 0.6, "triangle", 0.25);
}

export function honk() {
  tone(392, 0, 0.28, "square", 0.12);
  tone(494, 0, 0.28, "square", 0.12);
}

export function tick() {
  tone(1200, 0, 0.06, "sine", 0.15);
}

export function goodbye() {
  tone(523, 0, 0.25, "triangle", 0.2);
  tone(392, 0.15, 0.4, "triangle", 0.2);
}

export function dice() {
  for (let i = 0; i < 9; i++) tone(500 + Math.random() * 900, i * 0.12, 0.05, "square", 0.08);
}

export function step() {
  tone(520, 0, 0.07, "triangle", 0.18);
}

export function cash() {
  tone(1568, 0, 0.12, "sine", 0.2);
  tone(2093, 0.09, 0.3, "sine", 0.2);
}

export function build() {
  for (let i = 0; i < 4; i++) tone(140, i * 0.16, 0.12, "square", 0.14);
  tone(784, 0.7, 0.4, "triangle", 0.2);
}

export function buzzer() {
  tone(110, 0, 0.5, "sawtooth", 0.16);
  tone(117, 0, 0.5, "sawtooth", 0.16);
}

export function fanfare() {
  [523, 659, 784, 1047, 784, 1047].forEach((frequency, index) => tone(frequency, index * 0.16, 0.4, "triangle", 0.25));
}
