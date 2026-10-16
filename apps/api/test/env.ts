// Loaded by Jest before any test module, so the app reads these at import time
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://hr:hr@localhost:5432/hrportal_test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-only-secret-0123456789';
process.env.MAIL_TRANSPORT = 'memory';
process.env.THROTTLE = 'off';
process.env.STORAGE_DIR = require('path').join(require('os').tmpdir(), 'gpp-test-storage');
