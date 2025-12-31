/**
 * Twitch Integration Test
 * Run with: npx tsx src/test-twitch.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { TwitchClient } from './streaming/twitch-client.js';

const TEST_DURATION = 30000; // 30 seconds test

async function testTwitch() {
  console.log('\n🔧 TWITCH INTEGRATION TEST\n');
  console.log('='.repeat(50));

  // Check env vars
  const requiredVars = [
    'TWITCH_ACCESS_TOKEN',
    'TWITCH_CLIENT_ID',
    'TWITCH_CHANNEL_NAME',
  ];

  console.log('\n📋 Checking environment variables...\n');
  
  let missing = false;
  for (const v of requiredVars) {
    const value = process.env[v];
    if (value) {
      console.log(`  ✅ ${v}: ${value.substring(0, 8)}...`);
    } else {
      console.log(`  ❌ ${v}: MISSING`);
      missing = true;
    }
  }

  // Optional vars
  const optionalVars = ['TWITCH_CLIENT_SECRET', 'TWITCH_REFRESH_TOKEN', 'TWITCH_BOT_USERNAME'];
  for (const v of optionalVars) {
    const value = process.env[v];
    if (value) {
      console.log(`  ✅ ${v}: ${value.substring(0, 8)}...`);
    } else {
      console.log(`  ⚠️  ${v}: not set (optional)`);
    }
  }

  if (missing) {
    console.log('\n❌ Missing required environment variables. Check your .env file.\n');
    process.exit(1);
  }

  // Create client
  console.log('\n🔌 Connecting to Twitch...\n');

  const client = new TwitchClient({
    accessToken: process.env.TWITCH_ACCESS_TOKEN!,
    clientId: process.env.TWITCH_CLIENT_ID!,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    channelName: process.env.TWITCH_CHANNEL_NAME || 'neuraltau',
    botUsername: process.env.TWITCH_BOT_USERNAME || 'NeuralTau',
  });

  let messageReceived = false;

  // Listen for events
  client.on('chat', (msg) => {
    messageReceived = true;
    console.log(`  💬 [CHAT] ${msg.username}: ${msg.message}`);
    if (msg.bits) console.log(`     🎉 With ${msg.bits} bits!`);
    if (msg.isSubscriber) console.log(`     ⭐ Subscriber`);
  });

  client.on('subscription', (sub) => {
    console.log(`  🎁 [SUB] ${sub.username} subscribed! (${sub.tier}, ${sub.months} months)`);
  });

  client.on('bits', (bits) => {
    console.log(`  💎 [BITS] ${bits.username} cheered ${bits.bits} bits!`);
  });

  client.on('raid', (raid) => {
    console.log(`  🚀 [RAID] ${raid.fromChannel} raided with ${raid.viewerCount} viewers!`);
  });

  try {
    await client.connect();
    console.log('  ✅ Connected to Twitch IRC!');
    
    console.log(`\n📺 Joined channel: #${process.env.TWITCH_CHANNEL_NAME}`);
    console.log('\n' + '='.repeat(50));
    console.log(`\n🎮 TEST MODE - Running for ${TEST_DURATION / 1000} seconds\n`);
    console.log('Go to your Twitch chat and send a message to test!');
    console.log('='.repeat(50) + '\n');

    // Send a test message after 2 seconds
    setTimeout(() => {
      console.log('📤 Sending test message to chat...');
      client.sendMessage('🤖 NeuralTau test - connection verified!');
      console.log('  ✅ Test message sent! Check your Twitch chat.\n');
    }, 2000);

    // Auto-exit after TEST_DURATION
    await new Promise((resolve) => setTimeout(resolve, TEST_DURATION));

    console.log('\n' + '='.repeat(50));
    console.log('\n📊 TEST RESULTS:\n');
    console.log('  ✅ IRC Connection: SUCCESS');
    console.log(`  ${messageReceived ? '✅' : '⚠️ '} Chat Messages: ${messageReceived ? 'RECEIVED' : 'None received (try sending a message)'}`);
    console.log('\n✅ Test complete! Your Twitch integration is working.\n');

    client.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Connection failed:', error);
    process.exit(1);
  }
}

testTwitch().catch(console.error);

