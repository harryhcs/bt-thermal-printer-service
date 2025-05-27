import noble from '@abandonware/noble';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function initializeBluetooth() {
  if (process.platform === 'linux') {
    try {
      console.log('Initializing Bluetooth adapter...');
      
      // First check if the adapter is up
      try {
        const { stdout } = await execAsync('hciconfig hci0');
        if (stdout.includes('UP RUNNING')) {
          console.log('Bluetooth adapter is already up');
          return;
        }
      } catch (error) {
        console.log('Bluetooth adapter not found or not up');
      }

      // Try to bring the adapter up first
      try {
        console.log('Bringing up Bluetooth adapter...');
        await execAsync('sudo hciconfig hci0 up');
        // Wait a moment for the adapter to initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.log('Error bringing up adapter:', error.message);
      }

      // Now try to set piscan mode
      try {
        console.log('Setting piscan mode...');
        await execAsync('sudo hciconfig hci0 piscan');
        console.log('Bluetooth adapter initialized');
      } catch (error) {
        console.log('Error setting piscan mode:', error.message);
      }
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

    // Wait for noble to be powered on
    if (noble.state !== 'poweredOn') {
      console.log('Waiting for Bluetooth to be ready...');
      noble.once('stateChange', (state) => {
        if (state === 'poweredOn') {
          console.log('Bluetooth is ready, starting scan...');
          // On Ubuntu, we need to scan with allowDuplicates=true
          const allowDuplicates = process.platform === 'linux';
          console.log('Using allowDuplicates:', allowDuplicates);
          startScan(allowDuplicates);
        } else {
          console.log('Bluetooth state:', state);
          reject(new Error('Bluetooth is not ready'));
        }
      });
    } else {
      // On Ubuntu, we need to scan with allowDuplicates=true
      const allowDuplicates = process.platform === 'linux';
      console.log('Using allowDuplicates:', allowDuplicates);
      startScan(allowDuplicates);
    }

    function startScan(allowDuplicates) {
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

// Run the scan
console.log('Starting Bluetooth scan test...');
console.log('Platform:', process.platform);
console.log('Noble state:', noble.state);

scanForDevices()
  .then(devices => {
    console.log('Scan completed. Found devices:', devices);
    process.exit(0);
  })
  .catch(error => {
    console.error('Scan failed:', error);
    process.exit(1);
  }); 