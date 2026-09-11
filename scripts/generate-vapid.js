const { generateVapidKeys } = require('../lib/webpush');

const keys = generateVapidKeys();
console.log('Adicione ao .env.local (e às variáveis de ambiente da Vercel):\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:alertas@agrorisk.app');
console.log('\nA chave privada nunca deve ser versionada nem aparecer em prints da apresentação.');
