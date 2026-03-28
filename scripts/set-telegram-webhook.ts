import axios from 'axios';
import { env } from '../src/config/env';

async function setWebhook(): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const webhookUrl = env.TELEGRAM_WEBHOOK_URL;

  if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN is not set in .env');
    process.exit(1);
  }
  if (!webhookUrl) {
    console.error('❌ TELEGRAM_WEBHOOK_URL is not set in .env');
    console.log('   Set it to your public HTTPS URL, e.g.:');
    console.log('   TELEGRAM_WEBHOOK_URL=https://xxxx.ngrok.io');
    process.exit(1);
  }

  const fullWebhookUrl = `${webhookUrl}/telegram/webhook`;
  const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;

  console.log(`\n📡 Setting Telegram webhook...`);
  console.log(`   URL: ${fullWebhookUrl}`);

  try {
    const resp = await axios.post(apiUrl, {
      url: fullWebhookUrl,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });

    if (resp.data.ok) {
      console.log(`✅ Webhook set successfully!`);
      console.log(`   ${resp.data.description}`);
    } else {
      console.error(`❌ Failed to set webhook:`, resp.data);
    }
  } catch (err) {
    console.error('❌ Error calling Telegram API:', (err as Error).message);
  }
}

setWebhook();
