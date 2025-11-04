import { getConfig } from './config/config.js';
import { createServer } from './server.js';
import { closeDatabase } from './db/database.js';

async function main() {
  try {
    // Load configuration
    const config = getConfig();

    // Create and start server with cleanup service
    const { server, statsCleanupService } = await createServer(config);
    
    await server.listen({
      port: config.server.port,
      host: config.server.host,
    });

    console.log(`Key Commune proxy server started on ${config.server.host}:${config.server.port}`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      
      // Stop the stats cleanup service
      statsCleanupService.stop();
      
      // Close the server
      await server.close();
      closeDatabase();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();