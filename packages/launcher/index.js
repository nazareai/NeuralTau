import concurrently from 'concurrently';

console.log('🚀 Starting Tau - Autonomous AI Streamer...\n');

const { result } = concurrently(
  [
    {
      command: 'pnpm --filter @tau/bot dev',
      name: 'bot',
      prefixColor: 'blue',
    },
    {
      command: 'pnpm --filter @tau/web dev',
      name: 'web',
      prefixColor: 'magenta',
    },
  ],
  {
    prefix: 'name',
    killOthers: ['failure', 'success'],
    restartTries: 3,
  }
);

result.then(
  () => {
    console.log('\n✅ All services stopped successfully');
    process.exit(0);
  },
  (error) => {
    console.error('\n❌ Error running services:', error);
    process.exit(1);
  }
);
