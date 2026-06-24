require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const { assertProductionEnv } = require('./config/env');
const { createApp } = require('./app');
const setupEditorSockets = require('./sockets/editorSockets');

assertProductionEnv();

const { app, corsOptions } = createApp();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

const io = new Server(server, {
  cors: corsOptions,
  maxHttpBufferSize: 1e6
});

setupEditorSockets(io);

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
});
