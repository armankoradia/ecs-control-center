const computeHttpBase = () => {
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE.replace(/\/$/, "");
  const { protocol, hostname } = window.location;
  const baseProtocol = protocol.startsWith("http") ? protocol : "http:";
  return `${baseProtocol}//${hostname}:8000`;
};

const computeWsBase = () => {
  const httpBase = computeHttpBase();
  const url = new URL(httpBase);
  const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${url.host}`;
};

export const API_BASE = computeHttpBase();
export const WS_BASE = computeWsBase();


