// Prints plan/credit information of the audio services (no secrets).
import { secret } from './secrets.mjs';

const el = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': secret('ELEVENLABS_API_KEY') } });
const sub = await el.json();
console.log('ElevenLabs', el.status, el.ok ? { tier: sub.tier, used: sub.character_count, limit: sub.character_limit, status: sub.status } : sub);

const su = await fetch('https://api.sunoapi.org/api/v1/generate/credit', { headers: { Authorization: `Bearer ${secret('SUNO_API_KEY')}` } });
console.log('sunoapi.org', su.status, await su.text());
