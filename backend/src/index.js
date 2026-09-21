'use strict';

const http = require('http');
const config = require('./config');
const { createSocketServer } = require('./sockets/socketServer');
const { createApp } = require('./app');

// Socket.IO needs the raw HTTP server up front, and the Express app needs
// `io` to emit events from within routes - so we create the HTTP server
// and socket layer first, then build the app around them.
const httpServer = http.createServer();
const io = createSocketServer(httpServer);
const { app } = createApp({ io });

// Socket.IO registered its own 'request' listener when it attached above and
// answers everything under /socket.io/ itself (handshake, polling, and the
// bundled client script). Node fires every 'request' listener, so Express
// must skip those paths or it will try to 404 a response Socket.IO already
// sent, which throws ERR_HTTP_HEADERS_SENT and drops the connection.
const socketPath = io.path();
httpServer.on('request', (req, res) => {
  if (req.url === socketPath || req.url.startsWith(`${socketPath}/`)) return;
  app(req, res);
});

httpServer.listen(config.port, () => {
  console.log(`[classroom-survey] backend listening on port ${config.port} (${config.nodeEnv})`);
  console.log(`[classroom-survey] storage engine: ${config.storageEngine}`);
  console.log(`[classroom-survey] synthesis provider: ${config.synthesisProvider}`);
  console.log(`[classroom-survey] public base URL: ${config.publicBaseUrl}`);
});

module.exports = { httpServer, io, app };
