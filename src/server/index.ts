import { createChatServer } from './chatServer.js';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

const { httpServer } = createChatServer({ clientOrigin: CLIENT_ORIGIN });
httpServer.listen(PORT, () => {
  console.log(`Chat server listening on http://localhost:${PORT}`);
});
