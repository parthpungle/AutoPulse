// One vibration WebSocket (/api/vibration/live) per mounted view. Framework-free so it is tested with a fake socket.
//  - at most one socket at a time: a reconnect only happens after the previous socket has closed;
//  - close() cancels the socket and any pending reconnect, so an unmounted view leaves nothing running
//    (the server cancels its simulation task when the socket closes: autopulse/vibstream.run_session);
//  - events from a socket that has been replaced or closed are ignored, as are messages that are not JSON.

export const vibrationUrl = (loc = globalThis.location) =>
  `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/api/vibration/live`;

export function connectVibration({ url, onMessage, onStatus = () => {}, WS = globalThis.WebSocket, retryMs = 1500,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let sock = null;
  let retry = null;
  let closed = false;

  const open = () => {
    retry = null;
    const s = new WS(url);
    sock = s;
    s.onopen = () => { if (sock === s) onStatus(true); };
    s.onmessage = (e) => {
      if (sock !== s) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      onMessage(msg);
    };
    s.onclose = () => {
      if (sock !== s) return;
      sock = null;
      onStatus(false);
      if (!closed) retry = setTimer(open, retryMs);
    };
  };
  open();

  return {
    /** Sends a command if the socket is open; returns whether it was sent. */
    send(msg) {
      if (!sock || sock.readyState !== 1) return false;
      sock.send(JSON.stringify(msg));
      return true;
    },
    close() {
      closed = true;
      if (retry !== null) clearTimer(retry);
      retry = null;
      const s = sock;
      sock = null;
      s?.close();
    },
  };
}
