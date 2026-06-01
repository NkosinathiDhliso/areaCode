// Re-export WebSocket client as Socket.io-compatible API
// All Socket.io functionality now uses native WebSocket via API Gateway
export {
  getSocket,
  disconnectSocket,
  setSocketOverride,
  getWebSocket,
  disconnectWebSocket,
  setWebSocketUrl,
} from './websocket'
