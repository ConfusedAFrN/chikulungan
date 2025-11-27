import mqtt from 'mqtt';

const options = {
  clientId: 'web-' + Math.random().toString(16).substr(2, 8),
  keepalive: 60,
  reconnectPeriod: 1000,
  // Add debug
  debug: true,
};

// Use EMQX WebSocket (browser-safe, no auth)
const client = mqtt.connect('ws://broker.emqx.io:8083/mqtt', options);

client.on('connect', () => {
  console.log('Web MQTT Connected!'); // ← Check browser console
  client.subscribe('chickulungan/sensor/#');
  client.subscribe('chickulungan/log');
  client.subscribe('chickulungan/status');
  console.log('Subscribed to topics');
});

client.on('message', (topic, message) => {
  const payload = message.toString();
  console.log(`MQTT Message: ${topic} = ${payload}`); // ← Debug log
  window.dispatchEvent(new CustomEvent('mqtt-message', { detail: { topic, payload } }));
});

client.on('error', (err) => {
  console.error('MQTT Error:', err); // ← Check for errors
});

export const publishFeed = () => {
  client.publish('chickulungan/control/feed', '1');
  console.log('Published feed command');
};

export default client;