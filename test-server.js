import express from 'express';
import noble from '@abandonware/noble';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();

async function initializeBluetooth() {
  if (process.platform === 'linux') {
    try {
      console.log('Initializing Bluetooth adapter...');
      await execAsync('sudo hciconfig hci0 reset');
      await execAsync('sudo hciconfig hci0 piscan');
      await execAsync('sudo hciconfig hci0 up');
      console.log('Bluetooth adapter initialized');
    } catch (error) {
      console.error('Error initializing Bluetooth:', error);
    }
  }
}

async function scanForDevices() {
  return new Promise(async (resolve, reject) => {
    const devices = [];

    // Initialize Bluetooth adapter first
    await initializeBluetooth();

    // Reset noble state
    if (noble.state === 'poweredOn') {
      await noble.stopScanningAsync();
    }

    // Wait for noble to be powered on
    if (noble.state !== 'poweredOn') {
      console.log('Waiting for Bluetooth to be ready...');
      noble.once('stateChange', (state) => {
        if (state === 'poweredOn') {
          console.log('Bluetooth is ready, starting scan...');
          const allowDuplicates = process.platform === 'linux';
          console.log('Using allowDuplicates:', allowDuplicates);
          startScan(allowDuplicates);
        } else {
          console.log('Bluetooth state:', state);
          reject(new Error('Bluetooth is not ready'));
        }
      });
    } else {
      const allowDuplicates = process.platform === 'linux';
      console.log('Using allowDuplicates:', allowDuplicates);
      startScan(allowDuplicates);
    }

    function startScan(allowDuplicates) {
      // Remove any existing listeners
      noble.removeAllListeners('discover');
      noble.removeAllListeners('scanStart');
      noble.removeAllListeners('scanStop');
      noble.removeAllListeners('warning');

      const timeout = setTimeout(() => {
        console.log('Scan timeout reached');
        noble.stopScanning();
        console.log('Found devices:', devices);
        resolve(devices);
      }, 10000);

      noble.on('discover', (peripheral) => {
        console.log('Found device:', {
          name: peripheral.advertisement.localName || 'Unknown',
          id: peripheral.id,
          address: peripheral.address,
          rssi: peripheral.rssi,
          services: peripheral.advertisement.serviceUuids || []
        });
        devices.push({
          name: peripheral.advertisement.localName,
          id: peripheral.id,
          address: peripheral.address,
          rssi: peripheral.rssi,
          services: peripheral.advertisement.serviceUuids
        });
      });

      noble.on('scanStart', () => {
        console.log('Scan started');
      });

      noble.on('scanStop', () => {
        console.log('Scan stopped');
      });

      noble.on('warning', (message) => {
        console.warn('Noble warning:', message);
      });

      noble.startScanningAsync([], allowDuplicates).catch(err => {
        console.error('Error starting scan:', err);
        reject(err);
      });
    }
  });
}

// API Routes
app.get('/devices', async (req, res) => {
  try {
    console.log('Received /devices request');
    const devices = await scanForDevices();
    console.log('Sending response with devices:', devices);
    res.json(devices);
  } catch (error) {
    console.error('Error in /devices:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
}); 