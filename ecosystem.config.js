module.exports = {
  apps: [
    {
      name: 'goliath-dev',
      cwd: '/home/goliath/dev',
      script: 'server.js',

      env: {
        BOT_MODE: 'dev',
        NODE_ENV: 'development',
        PORT: 3001,
        BOT_API_PORT: 3002,
      },

      watch: false,
      autorestart: true,
      min_uptime: '15s',
      max_restarts: 5,
      max_memory_restart: '500M',
      restart_delay: 5000,
      time: true,
    },

    {
      name: 'goliath-beta',
      cwd: '/home/goliath/beta',
      script: 'server.js',

      env: {
        BOT_MODE: 'beta',
        NODE_ENV: 'production',
        PORT: 3011,
        BOT_API_PORT: 3012,
      },

      watch: false,
      autorestart: true,
      min_uptime: '15s',
      max_restarts: 5,
      max_memory_restart: '1G',
      restart_delay: 5000,
      time: true,
    },

    {
      name: 'goliath-production',
      cwd: '/home/goliath/production',
      script: 'server.js',

      env: {
        BOT_MODE: 'production',
        NODE_ENV: 'production',
        PORT: 3021,
        BOT_API_PORT: 3022,
      },

      watch: false,
      autorestart: true,
      min_uptime: '15s',
      max_restarts: 5,
      max_memory_restart: '1G',
      restart_delay: 5000,
      time: true,
    },
  ],
};