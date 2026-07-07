import { createCitadelServer } from './citadelServer.js';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

const { httpServer } = await createCitadelServer({
  clientOrigin: CLIENT_ORIGIN,
  enabledAppIdsInput: process.env.CITADEL_ENABLED_APPS
});

httpServer.listen(PORT, () => {
  console.log(`Citadel platform listening on http://localhost:${PORT}`);
});
