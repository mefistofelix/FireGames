// Message link between the TV (host) and the phones (guests). Bodies are plain JSON objects.
// The game code only uses openHost / openGuest, so the transport can change without touching the games.
//
// Envelope on the wire: {from, to, body}. Two transports carry it:
// - WebSocket to the server inside the Fire TV app (LanServer.kt), which forwards each envelope to the
//   socket registered with the id in "to". This is the real one: phones and TV on the same LAN.
// - BroadcastChannel, when the pages are opened from "localhost": TV page and pad pages side by side in one
//   browser on the development PC, with any static file server.

const HOST = "tv";
const RECONNECT_MS = 1000;

function socketTransport(id, onEnvelope, onOpen) {
  let socket = null;
  const connect = () => {
    socket = new WebSocket("ws://" + location.host + "/ws?id=" + encodeURIComponent(id));
    socket.onopen = onOpen;
    socket.onmessage = (event) => onEnvelope(JSON.parse(event.data));
    socket.onclose = () => setTimeout(connect, RECONNECT_MS);
  };
  connect();
  return (envelope) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(envelope));
  };
}

function channelTransport(id, onEnvelope, onOpen) {
  const channel = new BroadcastChannel("firegames");
  channel.onmessage = (event) => {
    if (event.data.to === id) onEnvelope(event.data);
  };
  setTimeout(onOpen, 0);
  return (envelope) => channel.postMessage(envelope);
}

function transport(id, onEnvelope, onOpen) {
  const development = location.hostname === "localhost";
  const open = development ? channelTransport : socketTransport;
  return open(id, onEnvelope, onOpen);
}

// onMessage(peerId, body) is called for every message a phone sends. When a phone's socket closes the
// server sends {t: "bye"} on its behalf.
export function openHost(onMessage) {
  const post = transport(HOST, (envelope) => onMessage(envelope.from, envelope.body), () => {});
  return {
    send(peerId, body) {
      post({ from: HOST, to: peerId, body });
    },
  };
}

// onMessage(body) is called for every message the TV sends to this phone; onOpen every time the link
// (re)opens, so the phone can introduce itself again.
export function openGuest(peerId, onMessage, onOpen) {
  const post = transport(peerId, (envelope) => onMessage(envelope.body), onOpen);
  return {
    send(body) {
      post({ from: peerId, to: HOST, body });
    },
  };
}
