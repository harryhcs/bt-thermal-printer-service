import fetch from 'node-fetch';

const DEVICE_ID = '5e953e95bd56acedf277e8da5ec6dc3a';
const BASE_URL = 'http://localhost:3000';

async function sendPrintRequest(endpoint, data) {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: DEVICE_ID,
        ...data
      })
    });
    const result = await response.json();
    console.log(`Response from ${endpoint}:`, result);
    return result;
  } catch (error) {
    console.error(`Error sending request to ${endpoint}:`, error);
  }
}

// Send all requests simultaneously
Promise.all([
  // Text print 1
  sendPrintRequest('/print/text', {
    text: "=== TEXT PRINT 1 ===\nThis is the first text print\n==================="
  }),
  
  // Receipt 1
  sendPrintRequest('/print/receipt', {
    title: "=== RECEIPT 1 ===",
    items: [
      {"name": "First Item", "price": "R 10.00"},
      {"name": "Second Item", "price": "R 20.00"}
    ],
    total: 30.00
  }),
  
  // Text print 2
  sendPrintRequest('/print/text', {
    text: "=== TEXT PRINT 2 ===\nThis is the second text print\n==================="
  }),
  
  // Receipt 2
  sendPrintRequest('/print/receipt', {
    title: "=== RECEIPT 2 ===",
    items: [
      {"name": "Third Item", "price": "R 50.00"},
      {"name": "Fourth Item", "price": "R 75.00"},
      {"name": "Fifth Item", "price": "R 25.00"}
    ],
    total: 150.00
  })
]).then(() => {
  console.log('All requests sent');
}).catch(error => {
  console.error('Error sending requests:', error);
}); 