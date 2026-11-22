// Values shared by the TV page and the phone page.

export const COLORS = [
  { id: "rosso", hex: "#e63946" },
  { id: "arancio", hex: "#f77f00" },
  { id: "giallo", hex: "#ffd23f" },
  { id: "verde", hex: "#2ec46d" },
  { id: "azzurro", hex: "#35c6f0" },
  { id: "blu", hex: "#3a6ff7" },
  { id: "viola", hex: "#9b5de5" },
  { id: "rosa", hex: "#ff6fb5" },
];

export const GAMES = [
  { name: "Grand Viale", icon: "🏨", tagline: "Compra terreni, costruisci hotel, manda in rovina gli amici" },
  { name: "Dominio", icon: "🎖️", tagline: "Carri armati, dadi e conquista del mondo" },
  { name: "Occhio di Falco", icon: "🔍", tagline: "Trova il personaggio nascosto prima degli altri" },
];

export const NAME_MAX_LENGTH = 12;

// A phone that sends nothing for this long has left; the phone uses the same time to notice a silent TV.
export const SILENCE_MS = 6000;
export const PING_MS = 2000;

// Address the phones open, shown as QR code on the TV. The server inside the Fire TV app answers /info with
// its LAN address ({ip, port, version}); a development file server has no /info and the pad is next to this page.
export async function serverInfo() {
  const response = await fetch("/info");
  if (!response.ok) return null;
  return response.json();
}

export function padUrl(info) {
  if (!info) return new URL("../pad/", location.href).href;
  return "http://" + info.ip + ":" + info.port + "/";
}
